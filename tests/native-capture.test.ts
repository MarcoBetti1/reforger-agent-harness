import {describe,expect,it} from "vitest";
import {captureSchema,engineJob} from "../src/native-capture-cli.js";
const base={id:"m998",prefab:"{5674FAEB9AB7BDD0}Prefabs/Vehicles/Wheeled/M998/M998_uncovered.et",views:[{label:"front",azimuth:0,elevation:0,distance:10}]};
describe("native capture job gates",()=>{
  it("converts angle cameras without inventing a native player view",()=>{const job=captureSchema.parse(base);expect(engineJob(job).offsets).toEqual(["0 0 10"]);expect(job.views[0].purpose).toBe("exterior");});
  it("requires bounded unique labels and actual seats for occupied state",()=>{expect(()=>captureSchema.parse({...base,views:[{label:"front"},{label:"front"}]})).toThrow();expect(()=>captureSchema.parse({...base,state:"occupied"})).toThrow();expect(()=>captureSchema.parse({...base,views:Array(25).fill({label:"x"})})).toThrow();});
  it("rejects script/path payloads and excessive image sizes",()=>{expect(()=>captureSchema.parse({...base,prefab:'x.et";Print("oops")'})).toThrow();expect(()=>captureSchema.parse({...base,resolution:[9000,9000]})).toThrow();});
  it("rejects claimed native crew views without an occupied native seat",()=>{expect(()=>captureSchema.parse({...base,views:[{label:"pilot",purpose:"native-crew"}]})).toThrow();expect(()=>captureSchema.parse({...base,seats:["Pilot"],views:[{label:"pilot",purpose:"native-crew",nativeSeat:"Pilot"}]})).not.toThrow();});
});
