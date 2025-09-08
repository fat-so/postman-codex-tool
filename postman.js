#!/usr/bin/env node
/**
 * postman.js (ESM)
 * Simple CLI to fetch and update a Postman collection using Postman API
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

function readJson(p) {
  const data = fs.readFileSync(p, 'utf8');
  return JSON.parse(data);
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function loadEnv(envPath) {
  const file = readJson(envPath);
  const map = {};
  if (Array.isArray(file.values)) {
    for (const v of file.values) {
      if (v && v.enabled !== false && v.key) {
        map[v.key] = v.value;
      }
    }
  }
  return map;
}

function request({ method, url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      port: u.port || 443,
      headers: headers,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({});
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Minimal JSON Patch (RFC6902) applier: supports add, replace, remove
function applyJsonPatch(doc, patchOps = []) {
  const clone = JSON.parse(JSON.stringify(doc));

  const getByPointer = (obj, pointer, createMissing = false) => {
    if (pointer === '' || pointer === '/') return { parent: null, key: null, target: obj };
    const parts = pointer.replace(/^\//, '').split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent = null;
    let key = null;
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      key = parts[i];
      parent = cur;
      if (i === parts.length - 1) break;
      if (!(key in cur)) {
        if (createMissing) {
          const next = parts[i + 1];
          cur[key] = String(+next) === next ? [] : {};
        } else {
          throw new Error(`Path not found: ${pointer}`);
        }
      }
      cur = cur[key];
    }
    return { parent, key, target: cur[key] };
  };

  for (const op of patchOps) {
    const { op: type, path: p } = op;
    if (!type || !p) throw new Error('Invalid patch op');
    if (type === 'add' || type === 'replace') {
      const { parent, key } = getByPointer(clone, p, true);
      if (parent == null) throw new Error('Cannot write to document root');
      parent[key] = op.value;
    } else if (type === 'remove') {
      const { parent, key } = getByPointer(clone, p, false);
      if (parent == null) throw new Error('Cannot remove document root');
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else {
      throw new Error(`Unsupported op: ${type}`);
    }
  }
  return clone;
}

async function getCollection({ apiKey, collectionUid }) {
  const url = `https://api.getpostman.com/collections/${collectionUid}`;
  const headers = { 'X-Api-Key': apiKey };
  return await request({ method: 'GET', url, headers });
}

async function updateCollection({ apiKey, collectionUid, collection }) {
  const url = `https://api.getpostman.com/collections/${collectionUid}`;
  const headers = {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
  const payload = collection.collection ? collection : { collection };
  return await request({ method: 'PUT', url, headers, body: payload });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else args[k] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function ensureAiSuffix(name) {
  if (!name) return name;
  return name.endsWith(' [AI]') ? name : `${name} [AI]`;
}

function namesEqualIgnoringAi(a, b) {
  const strip = (s) => (s || '').replace(/ \[AI\]$/,'');
  return strip(a) === strip(b);
}

function findItemByName(items, name) {
  if (!Array.isArray(items)) return null;
  return items.find(it => namesEqualIgnoringAi(it.name, name));
}

function ensureFolder(root, pathArr, markFinalAi = true) {
  let cur = root;
  for (let i = 0; i < pathArr.length; i++) {
    const part = pathArr[i];
    cur.item = cur.item || [];
    let next = findItemByName(cur.item, part);
    if (!next) {
      next = { name: part, item: [] };
      cur.item.push(next);
    }
    cur = next;
  }
  if (markFinalAi && cur && typeof cur.name === 'string') {
    cur.name = ensureAiSuffix(cur.name);
  }
  return cur;
}

function upsertRequest(folder, op) {
  folder.item = folder.item || [];
  const name = op.name || op.request?.name;
  if (!name) throw new Error('request op requires name');
  let reqItem = findItemByName(folder.item, name);
  const request = {
    method: op.method || op.request?.method || 'GET',
    header: op.headers || op.request?.header || [],
    url: op.url || op.request?.url,
    description: op.description || op.request?.description || '',
  };
  if (op.body || op.request?.body) request.body = op.body || op.request?.body;

  if (reqItem) {
    // update
    reqItem.name = ensureAiSuffix(reqItem.name || name);
    reqItem.request = request;
  } else {
    // create
    reqItem = { name: ensureAiSuffix(name), request, response: [] };
    folder.item.push(reqItem);
  }
  return reqItem;
}

function applyAiOperations(collection, ops, basePath = []) {
  const root = collection.collection || collection;
  // Ensure root has items
  root.item = root.item || [];
  // Strip all existing [AI] suffixes to avoid duplicate naming during this run
  const stripAllAi = (node) => {
    if (!node) return;
    if (Array.isArray(node.item)) {
      for (const it of node.item) stripAllAi(it);
    }
    if (typeof node.name === 'string') node.name = node.name.replace(/ \[AI\]$/,'');
  };
  stripAllAi(root);
  for (const op of ops) {
    const kind = op.kind || op.type;
    let path = op.path || [];
    if (!Array.isArray(path)) throw new Error('op.path must be an array');
    const fullPath = [...basePath, ...path];
    if (kind === 'folder') {
      ensureFolder(root, fullPath, true);
    } else if (kind === 'request') {
      // path refers to the folder containing the request
      const folder = ensureFolder(root, fullPath, true);
      upsertRequest(folder, op);
    } else {
      throw new Error(`Unsupported op kind: ${kind}`);
    }
  }
  return collection;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];
  const envPath = args.env || './postman.env.json';
  const env = fs.existsSync(envPath) ? loadEnv(envPath) : {};

  const apiKey = args.postmanApiKey || process.env.POSTMAN_API_KEY || env.postmanApiKey;
  const collectionUid = args.collectionUid || env.collectionUid;
  if (!cmd || !apiKey || !collectionUid) {
    console.error('Usage:');
    console.error('  node postman.js get --env <env.json> --collectionUid <uid> --out <file>');
    console.error('  node postman.js update --env <env.json> --input <file> --patch <true|false> [--out <file>]');
    process.exit(1);
  }

  if (cmd === 'get') {
    const out = args.out || args.output;
    const res = await getCollection({ apiKey, collectionUid });
    if (out) writeJson(out, res);
    else console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'update') {
    const inputPath = args.input || env.aiOutputFile;
    const isPatch = String(args.patch ?? env.aiOutputIsPatch ?? 'false').toLowerCase() === 'true';
    if (!inputPath) {
      console.error('Missing --input <file> for update');
      process.exit(1);
    }
    const input = readJson(inputPath);
    const current = await getCollection({ apiKey, collectionUid });
    const currentCollection = current.collection || current;

    const nextCollection = isPatch ? applyJsonPatch(currentCollection, input) : (input.collection || input);
    const out = args.out || args.output;
    if (out) writeJson(out, { collection: nextCollection });

    const updated = await updateCollection({ apiKey, collectionUid, collection: nextCollection });
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  if (cmd === 'ai') {
    const opsPath = args.ops || args.operations || args.input;
    if (!opsPath) {
      console.error('Missing --ops <file> describing operations');
      process.exit(1);
    }
    const opsFile = readJson(opsPath);
    const ops = Array.isArray(opsFile.operations) ? opsFile.operations : (Array.isArray(opsFile) ? opsFile : []);
    const base = Array.isArray(opsFile.base) ? opsFile.base : (args.base ? String(args.base).split('/').filter(Boolean) : []);
    const current = await getCollection({ apiKey, collectionUid });
    const currentCollection = current.collection || current;
    const mutated = applyAiOperations({ collection: currentCollection }, ops, base);
    const out = args.out || args.output;
    if (out) writeJson(out, mutated);
    const updated = await updateCollection({ apiKey, collectionUid, collection: mutated.collection || mutated });
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
