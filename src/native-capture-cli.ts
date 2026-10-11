import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { makeClientPlan, verifyInstalledAddons, classifyFatalClientLog } from "./client-cli.js";
import { requireStorageSpace } from "./storage-preflight.js";

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const label = z.string().regex(/^[a-z0-9-]{1,64}$/u);
export const captureSchema = z.object({
  id: label,
  prefab: z.string().regex(/^(?:\{[0-9A-Fa-f]{16}\})?[\w/.-]+\.et$/u),
  position: vector.default([600, 0.6, 2600]),
  center: vector.default([0, 1, 0]),
  useBounds: z.boolean().default(false),
  state: z.enum(["stopped", "occupied", "running"]).default("stopped"),
  seats: z.array(z.string().regex(/^[\w -]{1,64}$/u)).max(8).default([]),
  setupActions: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,95}$/u)).max(8).default([]),
  minRPM: z.number().min(1).max(1000).default(100),
  resolution: z.tuple([z.number().int().min(320).max(3840), z.number().int().min(240).max(2160)]).default([1280,720]),
  settleSeconds: z.number().min(0.1).max(20).default(2),
  initialSettleSeconds: z.number().min(5).max(60).default(12),
  views: z.array(z.object({
    label,
    azimuth: z.number().min(-360).max(360).default(45),
    elevation: z.number().min(-80).max(85).default(20),
    distance: z.number().min(0.1).max(500).default(15),
    offset: vector.optional(),
    lookOffset: vector.default([0,0,0]),
    fov: z.number().min(15).max(110).default(55),
    purpose: z.enum(["exterior", "inspection", "native-crew"]).default("exterior"),
    nativeSeat: z.string().regex(/^[\w -]{0,64}$/u).default(""),
    action: z.string().regex(/^(?:[A-Za-z][A-Za-z0-9_]{0,95})?$/u).default(""),
  })).min(1).max(120),
  buildFiles: z.array(z.string()).max(32).default([]),
}).strict().superRefine((job, ctx) => {
  if (new Set(job.views.map(v => v.label)).size !== job.views.length) ctx.addIssue({code:"custom", message:"View labels must be unique"});
  if(job.views.length * job.resolution[0] * job.resolution[1] * 3 > 512 * 1024 ** 2)ctx.addIssue({code:"custom",message:"Native captures exceed bounded 512 MiB raw image budget"});
  if (job.state === "occupied" && job.seats.length === 0) ctx.addIssue({code:"custom", message:"Occupied state requires actual seats"});
  if(job.setupActions.length && !job.seats.length) ctx.addIssue({code:"custom",message:"Setup actions require a genuine occupied actor"});
  if(job.views.some(v=>v.action) && !job.seats.length) ctx.addIssue({code:"custom",message:"View actions require a genuine occupied actor"});
  for(const view of job.views)if((view.purpose==="native-crew")!==Boolean(view.nativeSeat) || (view.nativeSeat && !job.seats.includes(view.nativeSeat)))ctx.addIssue({code:"custom",message:"Native crew view requires a declared occupied seat and native-crew purpose"});
});
export type CaptureJob = z.infer<typeof captureSchema>;

export function engineJob(job: CaptureJob): Record<string,unknown> {
  const offsets = job.views.map(view => {
    if (view.offset) return view.offset.join(" ");
    const a=view.azimuth*Math.PI/180, e=view.elevation*Math.PI/180;
    return [Math.sin(a)*Math.cos(e)*view.distance, Math.sin(e)*view.distance, Math.cos(a)*Math.cos(e)*view.distance].join(" ");
  });
  return {id:job.id,prefab:job.prefab,position:job.position.join(" "),center:job.center.join(" "),state:job.state,
    seats:job.seats,setupActions:job.setupActions,minRPM:job.minRPM,useBounds:job.useBounds,settleSeconds:job.settleSeconds,initialSettleSeconds:job.initialSettleSeconds,
    labels:job.views.map(v=>v.label),offsets,lookOffsets:job.views.map(v=>v.lookOffset.join(" ")),fovs:job.views.map(v=>v.fov),nativeSeats:job.views.map(v=>v.nativeSeat),viewActions:job.views.map(v=>v.action)};
}
async function absent(p:string):Promise<boolean> { try {await lstat(p);return false;} catch(e) {if((e as NodeJS.ErrnoException).code==="ENOENT")return true;throw e;} }
async function identity(p:string) {const data=await readFile(p);return {path:p,bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};}
async function verifyCaptureAddons(ids:string[],dirs:string[]):Promise<void> {
  for(const id of ids) {
    if(!/^[0-9a-f]{16}$/iu.test(id))throw new Error("Invalid addon GUID");
    let matched=false;
    for(const dir of dirs) {
      for(const folder of await readdir(dir,{withFileTypes:true})) {
        if(!folder.isDirectory())continue;
        const root=path.join(dir,folder.name);
        // Packed addons retain the existing trio checks. Named source .gproj
        // files are supported without copying/renaming a user's project.
        if(!await absent(path.join(root,"data.pak")))continue;
        for(const file of await readdir(root))if(file.endsWith(".gproj") && new RegExp(`\\bGUID\\s+"${id}"`,"iu").test(await readFile(path.join(root,file),"utf8")))matched=true;
      }
    }
    if(!matched)verifyInstalledAddons([id],dirs);
  }
}

export async function runNativeCapture(argv=process.argv.slice(2)):Promise<number> {
  if (!argv.length || argv.includes("--help")) {
    process.stdout.write("Native engine visual capture (dry run): --config JSON --game EXE --run-dir NEW_DIR --fixture-root DIR --addon GUID --addons-dir DIR [repeat] --python EXE [--execute]. One owned renderer, bounded 180-second wall limit. No OS capture/input or primary profile access.\n");return 0;
  }
  const options:Record<string,string[]>={};let execute=false;
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];if(flag==="--execute"){execute=true;continue;}
    if(!["--config","--game","--run-dir","--fixture-root","--addon","--addons-dir","--python"].includes(flag))throw new Error(`Unknown flag ${flag}`);
    const value=argv[++i];if(!value || value.startsWith("--"))throw new Error(`Missing value ${flag}`);
    if(options[flag] && !["--addon","--addons-dir"].includes(flag))throw new Error(`Duplicate ${flag}`);
    (options[flag]??=[]).push(value);
  }
  const required=(flag:string)=>{const value=options[flag]?.[0];if(!value)throw new Error(`Required ${flag}`);return path.resolve(value);};
  const config=required("--config"), game=required("--game"), runDir=required("--run-dir"), fixture=required("--fixture-root"), python=required("--python");
  if(!await absent(runDir))throw new Error("Run directory already exists; fresh runs must preserve earlier evidence");
  const job=captureSchema.parse(JSON.parse(await readFile(config,"utf8")));
  const dirs=(options["--addons-dir"]??[]).map(p=>path.resolve(p));
  const ids=options["--addon"]??[];
  await verifyCaptureAddons(ids,dirs);
  const world=job.views.some(view=>Boolean(view.nativeSeat))?"Worlds/CaptureCrew.ent":"Worlds/CaptureJob.ent";
  const plan=makeClientPlan({addonIds:ids,addonsDirs:dirs,world,forceUpdate:true,connectLocal:false,expectGame:false,durationSeconds:180,keepOpen:false,execute},game,runDir);
  const dimensions=new Set(["-screenWidth","-screenHeight"]);
  plan.args=plan.args.filter((arg,index,args)=>!dimensions.has(arg)&&!dimensions.has(args[index-1]??""));
  plan.args.push(`-screenWidth=${job.resolution[0]}`,`-screenHeight=${job.resolution[1]}`,"-worldSystemsConfig","{C50579A2EC48E8EF}Configs/Systems/MissionSystems.conf","-noFocus","-noBackend");
  const script=path.join(fixture,"addon","scripts","Game","NVC_VisualJob.c");
  const review=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","tools","native_capture_review.py");
  const sources=await Promise.all([script,path.join(fixture,"addon","NativeVisualCapture.gproj"),path.join(fixture,"addon",world),path.join(fixture,"addon",world.replace(".ent","_default.layer")),review,...job.buildFiles.map(p=>path.resolve(path.dirname(config),p))].map(identity));
  const manifest:Record<string,unknown>={kind:"native-engine-visual-inspection",gameExecutable:await identity(game),config:await identity(config),job,engineJob:engineJob(job),plan,sources,startedUtc:new Date().toISOString(),passed:false};
  process.stdout.write(JSON.stringify({job:job.id,plan,estimatedRawBytes:job.resolution[0]*job.resolution[1]*3*job.views.length},null,2)+"\n");
  if(!execute){process.stdout.write("Dry run only; no directories or renderer created. Add --execute.\n");return 0;}
  await requireStorageSpace([runDir]);
  const lockDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..",".cache","native-capture");await mkdir(lockDir,{recursive:true});
  const lockPath=path.join(lockDir,"renderer.lock");
  const lock=await open(lockPath,"wx").catch(()=>{throw new Error(`Native capture renderer lock exists: ${lockPath}. Inspect ownership before removing a stale lock.`);});
  await lock.writeFile(JSON.stringify({launcherPid:process.pid,runDir,startedUtc:manifest.startedUtc}));
  let child:ReturnType<typeof spawn>|undefined;
  let interrupted=false;
  const interrupt=()=>{interrupted=true;};
  process.on("SIGINT",interrupt);process.on("SIGTERM",interrupt);
  try {
    await mkdir(path.join(plan.profile,"profile"),{recursive:true});await mkdir(plan.logsDir,{recursive:true});await mkdir(plan.downloadDir,{recursive:true});
    await writeFile(path.join(plan.profile,"profile","NativeCapture-job.json"),JSON.stringify(engineJob(job),null,2));
    await writeFile(path.join(runDir,"manifest.json"),JSON.stringify(manifest,null,2));
    child=spawn(game,plan.args,{cwd:plan.cwd,stdio:"ignore",windowsHide:true});
    manifest.rendererPid=child.pid;
    let spawnError:Error|undefined;child.on("error",e=>{spawnError=e;});
    const deadline=Date.now()+180_000;let done=false;let consoleText="";
    while(Date.now()<deadline) {
      if(spawnError)throw spawnError;if(interrupted)throw new Error("Capture interrupted");
      consoleText=await readFile(path.join(plan.logsDir,"console.log"),"utf8").catch(()=>"");
      const fatal=classifyFatalClientLog(consoleText,false);
      if(fatal || /NVC_FAIL\|/u.test(consoleText) || /SCRIPT\s+\(E\).*NVC_/u.test(consoleText))throw new Error(fatal??"Native capture fixture failed; inspect console.log");
      done=consoleText.includes(`NVC_DONE|${job.id}|${job.views.length}`);
      if(child.exitCode!==null || child.signalCode!==null)break;
      if(done) {await delay(500);if(child.exitCode!==null)break;} else await delay(500);
    }
    manifest.engineVersionLines=consoleText.split(/\r?\n/u).filter(line=>/Initializing engine, version|Game version|Enfusion shader version/u.test(line));
    manifest.nativeTelemetry=consoleText.split(/\r?\n/u).filter(line=>/NVC_(JOB|SUBJECT|FRAME|STATE|CREW|VIEW|DONE|FAIL|ENGINE|SETUP_ACTION|VIEW_ACTION)/u.test(line));
    manifest.exitCode=child.exitCode;manifest.naturalExit=child.exitCode!==null;
    if(!done)throw new Error("No run-specific native completion marker before exit/timeout");
    const after=await Promise.all(sources.map(source=>identity(source.path)));
    manifest.sourceHashesAfter=after;
    if(after.some((source,index)=>source.sha256!==sources[index].sha256))throw new Error("Capture source changed during the run; freeze inputs and retry with fresh evidence");
    await writeFile(path.join(runDir,"manifest.json"),JSON.stringify(manifest,null,2));
    const validation=spawn(python,[review,"--run-dir",runDir],{stdio:"inherit",windowsHide:true});
    const reviewCode=await new Promise<number>((resolve,reject)=>{validation.on("error",reject);validation.on("exit",code=>resolve(code??1));});
    if(reviewCode!==0)throw new Error("Saved native pixels failed review gates");
    manifest.pixelValidationPassed=true;
    manifest.acceptance="awaiting_visual_inspection";
    process.stdout.write(`Native pixels and telemetry validated; visually inspect before accepting: ${runDir}\n`);return 0;
  } catch(e) {manifest.error=e instanceof Error?e.message:String(e);throw e;}
  finally {
    if(child && child.exitCode===null && child.signalCode===null){child.kill();manifest.forcedOwnerStop=true;}
    process.off("SIGINT",interrupt);process.off("SIGTERM",interrupt);
    if(!await absent(runDir))await writeFile(path.join(runDir,"manifest.json"),JSON.stringify(manifest,null,2));
    await lock.close();const {unlink}=await import("node:fs/promises");await unlink(lockPath);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)runNativeCapture().then(code=>{process.exitCode=code;}).catch(e=>{process.stderr.write(`${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;});
