import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const runId = process.env.AILSS_RUN_ID ?? new Date().toISOString().replace(/[:.]/gu, "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
let program = String.raw`
import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";
const input=JSON.parse(readFileSync(0,"utf8")),client=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),L=c.types.consistencies.localQuorum,S=c.types.consistencies.localSerial,u=c.types.Uuid.fromString,ld=c.types.LocalDate.fromString,q=(query,params=[],serial=false)=>client.execute(query,params,{prepare:true,consistency:L,...(serial?{serialConsistency:S}: {})}),num=v=>v&&typeof v.toNumber==="function"?v.toNumber():Number(v),uuid=(ns,value)=>{const b=createHash("sha256").update(ns+":"+value).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString("hex");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)},days=(a,b)=>{const out=[];let t=a.getTime(),last=b.getTime()-1;while(t<=last){const d=new Date(t).toISOString().slice(0,10);out.push(d);t=Date.parse(d+"T00:00:00.000Z")+86400000}return out};
await client.connect();let pageState=input.pageState?Buffer.from(input.pageState,"base64"):undefined,scanned=input.scanned??0,eligible=input.eligible??0,inserted=input.inserted??0,noOp=input.noOp??0,checksum=createHash("sha256"),conflicts=[];
do{const page=await client.execute("SELECT class_id,student_id,membership_id,state FROM membership_by_class_student",[],{prepare:false,consistency:L,fetchSize:100,pageState});for(const m of page.rows){scanned++;if(m.get("state")!=="ACTIVE")continue;const classId=String(m.get("class_id")),studentId=String(m.get("student_id")),membershipId=String(m.get("membership_id")),kr=(await q("SELECT name,state,schedule_state,schedule_version FROM class_by_id WHERE class_id=?",[u(classId)])).rows[0];if(!kr||kr.get("state")!=="ACTIVE"||kr.get("schedule_state")!=="PUBLISHED")continue;eligible++;const version=num(kr.get("schedule_version")),name=String(kr.get("name")),reservationId=uuid("p7.16-cutover-reservation",classId+":"+studentId+":"+version),operationId=uuid("p7.16-cutover-operation",classId+":"+studentId+":"+version),offeringId=uuid("p7.16-private-offering",classId),ids=(await q("SELECT session_id FROM sessions_by_class WHERE class_id=? LIMIT 201",[u(classId)])).rows.map(r=>String(r.get("session_id"))),segments=[],now=new Date();for(const id of ids){const s=(await q("SELECT session_id,title,start_at,end_at,mode,status,timezone,schedule_version FROM session_by_id WHERE session_id=?",[u(id)])).rows[0];if(!s||s.get("status")!=="SCHEDULED"||num(s.get("schedule_version"))!==version||s.get("end_at")<=now)continue;for(const day of days(s.get("start_at"),s.get("end_at")))segments.push({day,start:s.get("start_at"),end:s.get("end_at"),sessionId:id,entryId:uuid("p7.16-cutover-entry",reservationId+":"+day+":"+id),title:String(s.get("title")),mode:String(s.get("mode")),timezone:String(s.get("timezone"))});}let complete=true;for(const s of segments){const rows=(await q("SELECT entry_id,entry_state,reservation_id FROM student_schedule_by_day WHERE student_id=? AND schedule_day=?",[u(studentId),ld(s.day)])).rows;if(!rows.some(r=>String(r.get("entry_id"))===s.entryId&&r.get("entry_state")==="CONFIRMED"))complete=false;}if(complete){noOp++;checksum.update(classId+":"+studentId+":"+version+":noop\n");continue;}const lease=new Date(now.getTime()+10000),claim=await q("INSERT INTO student_schedule_guard (student_id,holder_operation_id,holder_reservation_id,lease_until,lease_fence,version,updated_at) VALUES (?,?,?,?,1,1,?) IF NOT EXISTS",[u(studentId),u(operationId),u(reservationId),lease,now],true);if(claim.rows[0]?.get("[applied]")!==true){const g=(await q("SELECT holder_operation_id,lease_until,version,lease_fence FROM student_schedule_guard WHERE student_id=?",[u(studentId)])).rows[0];if(!g||String(g.get("holder_operation_id"))!==operationId&&g.get("lease_until")>now){conflicts.push({classId,studentId,reason:"GUARD_BUSY"});continue;}const renewed=await q("UPDATE student_schedule_guard SET holder_operation_id=?,holder_reservation_id=?,lease_until=?,lease_fence=?,version=?,updated_at=? WHERE student_id=? IF version=?",[u(operationId),u(reservationId),lease,c.types.Long.fromNumber(num(g.get("lease_fence"))+1),c.types.Long.fromNumber(num(g.get("version"))+1),now,u(studentId),g.get("version")],true);if(renewed.rows[0]?.get("[applied]")!==true){conflicts.push({classId,studentId,reason:"GUARD_RACE"});continue;}}
let blocked=false;for(const s of segments){const rows=(await q("SELECT start_at,end_at,entry_state,expires_at,reservation_id FROM student_schedule_by_day WHERE student_id=? AND schedule_day=? LIMIT 200",[u(studentId),ld(s.day)])).rows;for(const r of rows)if(String(r.get("reservation_id"))!==reservationId&&(r.get("entry_state")==="CONFIRMED"||r.get("entry_state")==="HELD"&&r.get("expires_at")>now)&&s.start<r.get("end_at")&&r.get("start_at")<s.end){blocked=true;conflicts.push({classId,studentId,sessionId:s.sessionId,conflictingReservationId:String(r.get("reservation_id")),reason:"SCHEDULE_CONFLICT"});break;}if(blocked)break;}if(!blocked){const expires=new Date(now.getTime()+604800000);await q("INSERT INTO schedule_reservation_by_id (reservation_id,student_id,class_id,offering_id,operation_id,state,expires_at,segment_count,schedule_version,version,membership_id,created_at,updated_at) VALUES (?,?,?,?,?,'CONFIRMED',?,?,?,?,?,?,?)",[u(reservationId),u(studentId),u(classId),u(offeringId),u(operationId),expires,segments.length,c.types.Long.fromNumber(version),c.types.Long.fromNumber(1),u(membershipId),now,now]);for(const s of segments){await q("INSERT INTO schedule_reservation_segments_by_id (reservation_id,schedule_day,start_at,session_id,entry_id,end_at,class_id,class_name,student_id,offering_id,title,mode,timezone,schedule_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[u(reservationId),ld(s.day),s.start,u(s.sessionId),u(s.entryId),s.end,u(classId),name,u(studentId),u(offeringId),s.title,s.mode,s.timezone,c.types.Long.fromNumber(version)]);await q("INSERT INTO student_schedule_by_day (student_id,schedule_day,start_at,entry_id,end_at,class_id,class_name,session_id,offering_id,reservation_id,entry_state,expires_at,schedule_version,title,mode,timezone) VALUES (?,?,?,?,?,?,?,?,?,?,'CONFIRMED',null,?,?,?,?)",[u(studentId),ld(s.day),s.start,u(s.entryId),s.end,u(classId),name,u(s.sessionId),u(offeringId),u(reservationId),c.types.Long.fromNumber(version),s.title,s.mode,s.timezone]);}inserted++;checksum.update(classId+":"+studentId+":"+version+":"+segments.length+"\n");}await q("UPDATE student_schedule_guard SET lease_until=?,updated_at=? WHERE student_id=? IF holder_operation_id=?",[now,now,u(studentId),u(operationId)],true);}
pageState=page.pageState;}while(pageState);await client.shutdown();console.log(JSON.stringify({status:conflicts.length?"BLOCKED":"PASS",scanned,eligible,inserted,noOp,pageState:null,checksum:checksum.digest("hex"),conflicts}));`;
program = program
  .replace(
    "SELECT entry_id,entry_state,reservation_id FROM student_schedule_by_day WHERE student_id=? AND schedule_day=?",
    "SELECT class_id,session_id,entry_state,schedule_version FROM student_schedule_by_day WHERE student_id=? AND schedule_day=?",
  )
  .replace(
    'String(r.get("entry_id"))===s.entryId&&r.get("entry_state")==="CONFIRMED"',
    'String(r.get("class_id"))===classId&&String(r.get("session_id"))===s.sessionId&&r.get("entry_state")==="CONFIRMED"&&num(r.get("schedule_version"))===version',
  );
const result = JSON.parse(
  execFileSync(
    "docker",
    ["exec", "-i", "ailss-classroom-service", "node", "--input-type=module", "-e", program],
    { input: JSON.stringify({}), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ).trim(),
);
const artifact = { stage: "p7.16-controlled-schedule-cutover", runId, pageSize: 100, ...result };
await writeFile(new URL("p7.16-cutover.json", evidence), JSON.stringify(artifact, null, 2) + "\n");
await writeFile(
  new URL("p7.16-cutover-checkpoint.json", evidence),
  JSON.stringify(
    {
      scanned: result.scanned,
      eligible: result.eligible,
      inserted: result.inserted,
      noOp: result.noOp,
      pageState: result.pageState,
      checksum: result.checksum,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ ...artifact, evidence: decodeURIComponent(evidence.pathname) }));
if (result.status !== "PASS") process.exitCode = 2;
