import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

async function http(method, path, { body, token, key = randomUUID() } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "idempotency-key": key,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, json: await response.json() };
    } catch (error) {
      if (attempt >= 2 || error?.cause?.code !== "UND_ERR_SOCKET") throw error;
      await delay(100);
    }
  }
}
const user = {
  email: `fresh-commerce-${randomUUID()}@example.test`,
  password: `${randomUUID()}-Aa1!`,
  displayName: "Fresh Commerce",
};
const registered = await http("POST", "/api/v1/auth/register", { body: user });
assert.equal(registered.status, 201);
const logged = await http("POST", "/api/v1/auth/login", {
  body: { email: user.email, password: user.password },
});
assert.equal(logged.status, 200);
const token = logged.json.data.accessToken;
// Bounded read selects one integer-VND fixture created through Gateway by crash acceptance.
const probe = `import c from'cassandra-driver';const x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum,fetchSize:100};await x.connect();try{const rows=(await x.execute("SELECT offering_id,state,price,currency FROM offering_by_id LIMIT 100",[],q)).rows;const r=rows.find(v=>v.get('state')==='PUBLISHED'&&v.get('currency')==='VND'&&/^\\d+(?:\\.0+)?$/.test(String(v.get('price')))&&Number(v.get('price'))>0);if(!r)throw new Error('NO_PUBLISHED_INTEGER_VND_OFFERING');console.log(JSON.stringify({offeringId:String(r.get('offering_id')),amount:Number(r.get('price'))}))}finally{await x.shutdown();}`;
const fixture = JSON.parse(
  execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", probe], {
    encoding: "utf8",
  }).trim(),
);
const created = await http("POST", "/api/v1/orders", {
  token,
  body: { offeringId: fixture.offeringId },
});
assert.equal(created.status, 201, JSON.stringify(created.json));
const order = created.json.data;
const transactionId = Date.now();
const callbackBody = JSON.stringify({
  id: transactionId,
  transferType: "in",
  accountNumber: "__FROM_ENV__",
  transferAmount: fixture.amount,
  content: `AILSS${order.orderId.replaceAll("-", "").toUpperCase()}`,
});
const callback = `const b=${JSON.stringify(callbackBody)}.replace('__FROM_ENV__',process.env.SEPAY_ACCOUNT_NUMBER);const r=await fetch('http://api-gateway:8080/api/v1/payments/sepay/webhook',{method:'POST',headers:{'content-type':'application/json',authorization:'Apikey '+process.env.SEPAY_WEBHOOK_API_KEY},body:b});console.log(JSON.stringify({status:r.status,body:await r.text()}));`;
const accepted = JSON.parse(
  execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", callback], {
    encoding: "utf8",
  }).trim(),
);
assert.equal(accepted.status, 200, accepted.body);
let final;
for (let i = 0; i < 120; i++) {
  const value = await http("GET", `/api/v1/orders/${order.orderId}`, { token });
  if (value.status === 200) final = value.json.data;
  if (final?.state === "ENTITLED") break;
  await delay(500);
}
assert.equal(final?.state, "ENTITLED");
assert.equal(final.fulfillmentState, "ACTIVE");
console.log(
  JSON.stringify({
    stage: "fresh-commerce-after-broker-restart",
    status: "PASS",
    orderId: order.orderId,
    transactionId: String(transactionId),
    finalState: final.state,
    workerRestarted: false,
    directCanonicalMutation: false,
  }),
);
