/** Retire known local acceptance fixtures; retain canonical history and a local backup. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:' || (process.env.AILSS_PROFILE || 'dev-async') !== 'dev-async') throw Error('Only local dev-async is allowed');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw Error('Usage: cleanup-demo-fixtures.mjs [--apply]');
const token = (await request('/auth/login', 'POST', { email: 'lecturer.demo@ailss.local', password: process.env.AILSS_DEMO_LECTURER_PASSWORD || 'AilssLecturer!2026' })).accessToken;
async function request(path, method = 'GET', body, auth) {
  const response = await fetch(new URL('/api/v1' + path, origin), { method, headers: { ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'idempotency-key': randomUUID() } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${value.error?.code}`); return value.data;
}
const list = (value) => Array.isArray(value) ? value : value.items ?? value.classes ?? [];
const me = await request('/me', 'GET', undefined, token); assert.equal(me.role, 'LECTURER');
const courses = list(await request('/me/owned-courses', 'GET', undefined, token));
const classes = list(await request('/me/owned-classes', 'GET', undefined, token));
const staleCourses = courses.filter((item) => item.ownerLecturerId === me.userId && item.state === 'DRAFT' && /^(draft-p14-3a-|course-lesson-test-|khoa-hoc-thu-nghiem-mu)/.test(item.slug));
const staleClasses = classes.filter((item) => item.ownerLecturerId === me.userId && item.state === 'ACTIVE' && /^P14\.3B (Acceptance|Fixture)/.test(item.name));
const emptyDuplicates = [];
for (const item of classes.filter((item) => item.state === 'ACTIVE')) {
  if (!classes.some((other) => other.classId !== item.classId && other.state === 'ACTIVE' && other.name === item.name && other.linkedCourseId === item.linkedCourseId)) continue;
  const members = list(await request(`/classes/${item.classId}/members`, 'GET', undefined, token));
  if (!members.some((member) => member.state === 'ACTIVE')) emptyDuplicates.push(item);
}
const quizzes = [];
for (const course of courses.filter((item) => item.slug === 'demo-cassandra' && item.state === 'PUBLISHED')) {
  for (const quiz of list(await request(`/targets/COURSE/${course.courseId}/quizzes`, 'GET', undefined, token))) {
    if (/^(Phase 41 |Revision L )/.test(quiz.title)) quizzes.push(await request(`/quizzes/${quiz.quizId}`, 'GET', undefined, token));
  }
}
const backup = { capturedAt: new Date().toISOString(), lecturerId: me.userId, courses: staleCourses, classes: [...staleClasses, ...emptyDuplicates], quizzes };
const directory = new URL('../../tmp/demo-cleanup/', import.meta.url); await mkdir(directory, { recursive: true });
const file = new URL(`${Date.now()}.json`, directory); await writeFile(file, JSON.stringify(backup, null, 2));
if (apply) {
  for (const item of staleCourses) await request(`/courses/${item.courseId}/retire`, 'POST', { mode: 'DELETE' }, token);
  if (backup.classes.length) {
    const script = `import{readFileSync}from'node:fs';import c from'cassandra-driver';const input=JSON.parse(readFileSync(0,'utf8'));if(process.env.CASSANDRA_KEYSPACE!=='classroom_keyspace'||process.env.NODE_ENV==='production')throw Error('LOCAL_ONLY');const db=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});const q={prepare:true,consistency:c.types.consistencies.localQuorum},u=v=>c.types.Uuid.fromString(v);await db.connect();try{for(const expected of input.classes){const row=(await db.execute('SELECT * FROM class_by_id WHERE class_id=?',[u(expected.classId)],q)).rows[0];if(!row||String(row.owner_lecturer_id)!==input.lecturerId||row.name!==expected.name||Number(row.version)!==expected.version)throw Error('FIXTURE_MISMATCH');if(row.state!=='ACTIVE')continue;const changed=await db.execute("UPDATE class_by_id SET state='CLOSED',version=?,updated_at=? WHERE class_id=? IF owner_lecturer_id=? AND state='ACTIVE' AND version=?",[row.version.add(c.types.Long.ONE),new Date(),row.class_id,row.owner_lecturer_id,row.version],{...q,serialConsistency:c.types.consistencies.localSerial});if(!changed.rows[0]['[applied]'])throw Error('CONCURRENT_CHANGE');await db.execute('DELETE FROM classes_by_lecturer WHERE lecturer_id=? AND updated_at=? AND class_id=?',[row.owner_lecturer_id,row.updated_at,row.class_id],q);if(row.active_code_hash)await db.execute("UPDATE join_code_by_hash SET state='RETIRED' WHERE code_hash=? IF class_id=?",[row.active_code_hash,row.class_id],{...q,serialConsistency:c.types.consistencies.localSerial});}console.log(JSON.stringify({closedClasses:input.classes.length}));}finally{await db.shutdown();}`;
    console.log(execFileSync('docker', ['exec', '-i', 'ailss-classroom-service', 'node', '--input-type=module', '-e', script], { input: JSON.stringify(backup), encoding: 'utf8' }).trim());
  }
  if (quizzes.length) {
    // No public quiz retirement operation exists yet. This narrowly scoped local
    // maintenance command validates owner, target, title and version before writing.
    // It archives the canonical quiz and removes its published projection, retaining
    // attempts and results for audit rather than rewriting academic history.
    const script = `import{readFileSync}from'node:fs';import c from'cassandra-driver';const input=JSON.parse(readFileSync(0,'utf8'));if(process.env.CASSANDRA_KEYSPACE!=='assessment_keyspace'||process.env.NODE_ENV==='production')throw Error('LOCAL_ONLY');const db=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});const q={prepare:true,consistency:c.types.consistencies.localQuorum},u=v=>c.types.Uuid.fromString(v);await db.connect();let count=0;try{for(const expected of input.quizzes){const row=(await db.execute('SELECT * FROM quiz_by_id WHERE quiz_id=?',[u(expected.quizId)],q)).rows[0];if(!row||String(row.owner_id)!==input.lecturerId||String(row.target_id)!==expected.targetId||row.title!==expected.title||! /^(Phase 41 |Revision L )/.test(row.title))throw Error('FIXTURE_MISMATCH');if(row.state==='ARCHIVED')continue;if(row.state!=='PUBLISHED'||Number(row.record_version)!==expected.recordVersion)throw Error('VERSION_MISMATCH');const projected=(await db.execute('SELECT sort_at,quiz_id FROM quizzes_by_target_state_v2 WHERE target_type=? AND target_id=? AND state=?',[row.target_type,row.target_id,row.state],q)).rows.filter(p=>String(p.quiz_id)===expected.quizId);const changed=await db.execute("UPDATE quiz_by_id SET state='ARCHIVED',record_version=?,updated_at=? WHERE quiz_id=? IF state='PUBLISHED' AND record_version=?",[row.record_version.add(c.types.Long.ONE),new Date(),row.quiz_id,row.record_version],{...q,serialConsistency:c.types.consistencies.localSerial});if(!changed.rows[0]['[applied]'])throw Error('CONCURRENT_CHANGE');for(const p of projected)await db.execute('DELETE FROM quizzes_by_target_state_v2 WHERE target_type=? AND target_id=? AND state=? AND sort_at=? AND quiz_id=?',[row.target_type,row.target_id,'PUBLISHED',p.sort_at,row.quiz_id],q);count++;}console.log(JSON.stringify({archivedQuizzes:count}));}finally{await db.shutdown();}`;
    const result = execFileSync('docker', ['exec', '-i', 'ailss-assessment-service', 'node', '--input-type=module', '-e', script], { input: JSON.stringify(backup), encoding: 'utf8' });
    console.log(result.trim());
  }
}
console.log(JSON.stringify({ applied: apply, courses: staleCourses.length, classes: backup.classes.length, quizzes: quizzes.length, backup: file.pathname }));
