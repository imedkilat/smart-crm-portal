#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workflowPath = path.resolve(
  process.cwd(),
  'n8n/workflows/crm-follow-up-engine-mvp.json',
);
const shouldWrite = process.argv.includes('--write');

const source = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(source);

const requiredNodes = [
  'Build Eligible Workspace Scope',
  'Build Production-Safe Candidates',
  'Controlled Write Authorized',
  'Create Internal Follow-up Task',
  'Summarize Created Tasks',
  'Shadow / Dry Run Summary',
];

for (const name of requiredNodes) {
  if (!workflow.nodes.some((node) => node.name === name)) {
    throw new Error(`Follow-Up telemetry transformer expected node: ${name}`);
  }
}

const telemetryNames = new Set([
  'Prepare Follow-Up Write Telemetry',
  'Record Follow-Up Write Telemetry',
  'Prepare Follow-Up Suppressed Telemetry',
  'Record Follow-Up Suppressed Telemetry',
]);

workflow.nodes = workflow.nodes.filter((node) => !telemetryNames.has(node.name));

for (const connection of Object.values(workflow.connections || {})) {
  if (!Array.isArray(connection.main)) continue;
  for (let outputIndex = 0; outputIndex < connection.main.length; outputIndex += 1) {
    const branches = connection.main[outputIndex];
    if (!Array.isArray(branches)) continue;
    connection.main[outputIndex] = branches.filter(
      (branch) => !telemetryNames.has(branch?.node),
    );
  }
}

const writeTelemetryCode = `const candidates = $items('Build Production-Safe Candidates').map((item) => item.json);
const authorized = candidates.filter((row) => row.create_task === true && row.write_authorized === true && row.workspace_id);
const results = $items('Create Internal Follow-up Task').map((item) => item.json);
const executionId = String($execution.id || '');
const nowIso = new Date().toISOString();
const byWorkspace = new Map();

function ensure(workspaceId) {
  const key = String(workspaceId);
  if (!byWorkspace.has(key)) {
    byWorkspace.set(key, { workspace_id: key, selected_count: 0, created_count: 0, error_count: 0 });
  }
  return byWorkspace.get(key);
}

for (const candidate of authorized) {
  ensure(candidate.workspace_id).selected_count += 1;
}

for (let index = 0; index < authorized.length; index += 1) {
  const candidate = authorized[index];
  const result = results[index] || {};
  const stats = ensure(candidate.workspace_id);
  const failed = Boolean(result.error) || (!result.public_id && !result.id);
  if (failed) stats.error_count += 1;
  else stats.created_count += 1;
}

return Array.from(byWorkspace.values()).map((stats) => {
  const failed = stats.error_count > 0;
  const runRef = executionId || nowIso;
  return {
    json: {
      workspace_id: stats.workspace_id,
      automation_key: 'follow-up-engine',
      automation_name: 'Follow-Up Engine',
      source: 'n8n',
      trigger_type: 'scheduled',
      status: failed ? 'failed' : 'succeeded',
      run_ref: runRef,
      correlation_key: 'follow-up-engine:' + runRef + ':' + stats.workspace_id,
      record_type: 'workspace',
      record_id: stats.workspace_id,
      attempt_number: 1,
      started_at: nowIso,
      finished_at: nowIso,
      error_code: failed ? 'FOLLOW_UP_TASK_CREATE_FAILED' : null,
      error_message: failed ? 'One or more authorized follow-up task writes failed or returned no created task.' : null,
      selected_count: stats.selected_count,
      created_count: stats.created_count,
      error_count: stats.error_count,
    },
  };
});`;

const suppressedTelemetryCode = `const candidates = $items('Build Production-Safe Candidates').map((item) => item.json);
const executionId = String($execution.id || '');
const nowIso = new Date().toISOString();
const runRef = executionId || nowIso;

let scope = {};
try { scope = $('Build Eligible Workspace Scope').first().json || {}; } catch {}

const authorizedWorkspaceIds = new Set(
  candidates
    .filter((row) => row.create_task === true && row.write_authorized === true && row.workspace_id)
    .map((row) => String(row.workspace_id)),
);

const diagnosticRow = candidates.find((row) => Array.isArray(row.workspace_stats));
const workspaceStats = Array.isArray(diagnosticRow?.workspace_stats) ? diagnosticRow.workspace_stats : [];
const statsByWorkspace = new Map(
  workspaceStats
    .filter((row) => row?.workspace_id)
    .map((row) => [String(row.workspace_id), row]),
);

const scopedWorkspaceIds = Array.isArray(scope.scoped_workspace_ids)
  ? scope.scoped_workspace_ids.map(String)
  : [];
const workspaceIds = [...new Set(scopedWorkspaceIds)];

return workspaceIds
  .filter((workspaceId) => !authorizedWorkspaceIds.has(workspaceId))
  .map((workspaceId) => {
    const stats = statsByWorkspace.get(workspaceId) || {};
    return {
      json: {
        workspace_id: workspaceId,
        automation_key: 'follow-up-engine',
        automation_name: 'Follow-Up Engine',
        source: 'n8n',
        trigger_type: 'scheduled',
        status: 'suppressed',
        run_ref: runRef,
        correlation_key: 'follow-up-engine:' + runRef + ':' + workspaceId,
        record_type: 'workspace',
        record_id: workspaceId,
        attempt_number: 1,
        started_at: nowIso,
        finished_at: nowIso,
        error_code: null,
        error_message: null,
        suppression_reason: stats.skip_reason || 'no_authorized_follow_up_write',
        scanned_leads: Number(stats.scanned_leads || 0),
        eligible_candidates: Number(stats.eligible_candidates || 0),
        selected_candidates: Number(stats.selected_candidates || 0),
        authorized_candidates: Number(stats.authorized_candidates || 0),
      },
    };
  });`;

function telemetryInsertNode({ id, name, position }) {
  return {
    parameters: {
      operation: 'create',
      tableId: 'automation_runs',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'workspace_id', fieldValue: '={{ $json.workspace_id }}' },
          { fieldId: 'automation_key', fieldValue: '={{ $json.automation_key }}' },
          { fieldId: 'automation_name', fieldValue: '={{ $json.automation_name }}' },
          { fieldId: 'source', fieldValue: '={{ $json.source }}' },
          { fieldId: 'trigger_type', fieldValue: '={{ $json.trigger_type }}' },
          { fieldId: 'status', fieldValue: '={{ $json.status }}' },
          { fieldId: 'run_ref', fieldValue: '={{ $json.run_ref }}' },
          { fieldId: 'correlation_key', fieldValue: '={{ $json.correlation_key }}' },
          { fieldId: 'record_type', fieldValue: '={{ $json.record_type }}' },
          { fieldId: 'record_id', fieldValue: '={{ $json.record_id }}' },
          { fieldId: 'attempt_number', fieldValue: '={{ $json.attempt_number }}' },
          { fieldId: 'started_at', fieldValue: '={{ $json.started_at }}' },
          { fieldId: 'finished_at', fieldValue: '={{ $json.finished_at }}' },
          { fieldId: 'error_code', fieldValue: '={{ $json.error_code }}' },
          { fieldId: 'error_message', fieldValue: '={{ $json.error_message }}' },
        ],
      },
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position,
    id,
    name,
    onError: 'continueRegularOutput',
  };
}

workflow.nodes.push(
  {
    parameters: { mode: 'runOnceForAllItems', jsCode: writeTelemetryCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1744, -112],
    id: 'f6f6b7e4-f17c-4d44-89f1-624c7df1640b',
    name: 'Prepare Follow-Up Write Telemetry',
  },
  telemetryInsertNode({
    id: '1f2d42aa-e988-4e89-a33c-213a2a2f09e8',
    name: 'Record Follow-Up Write Telemetry',
    position: [1984, -112],
  }),
  {
    parameters: { mode: 'runOnceForAllItems', jsCode: suppressedTelemetryCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1504, 112],
    id: '28524256-84cb-4f55-a8ff-9d7345ac4f0d',
    name: 'Prepare Follow-Up Suppressed Telemetry',
  },
  telemetryInsertNode({
    id: '006f33f3-37c1-4654-9b21-0de41ade8361',
    name: 'Record Follow-Up Suppressed Telemetry',
    position: [1744, 112],
  }),
);

function connect(from, to, outputIndex = 0) {
  workflow.connections ||= {};
  workflow.connections[from] ||= { main: [] };
  workflow.connections[from].main ||= [];
  while (workflow.connections[from].main.length <= outputIndex) {
    workflow.connections[from].main.push([]);
  }
  const branches = workflow.connections[from].main[outputIndex] || [];
  if (!branches.some((branch) => branch?.node === to && branch?.index === 0)) {
    branches.push({ node: to, type: 'main', index: 0 });
  }
  workflow.connections[from].main[outputIndex] = branches;
}

connect('Summarize Created Tasks', 'Prepare Follow-Up Write Telemetry');
connect('Prepare Follow-Up Write Telemetry', 'Record Follow-Up Write Telemetry');
connect('Shadow / Dry Run Summary', 'Prepare Follow-Up Suppressed Telemetry');
connect('Prepare Follow-Up Suppressed Telemetry', 'Record Follow-Up Suppressed Telemetry');

for (const name of telemetryNames) {
  const count = workflow.nodes.filter((node) => node.name === name).length;
  if (count !== 1) throw new Error(`Expected exactly one telemetry node named ${name}; got ${count}`);
}

const safety = workflow.nodes.find((node) => node.name === 'Safety Configuration');
const safetyAssignments = safety?.parameters?.assignments?.assignments || [];
const safetyByName = new Map(safetyAssignments.map((row) => [row.name, row.value]));
if (safetyByName.get('write_enabled') !== false || safetyByName.get('production_mode') !== false) {
  throw new Error('Transformer refuses to alter a Follow-Up export whose repo safety defaults are not false/false.');
}

const output = JSON.stringify(workflow);
if (shouldWrite) {
  fs.writeFileSync(workflowPath, output);
  console.log(`Instrumented ${workflowPath}`);
} else {
  console.log('Follow-Up telemetry transform validation PASS');
  console.log(`Source nodes: ${JSON.parse(source).nodes.length}`);
  console.log(`Instrumented nodes: ${workflow.nodes.length}`);
}
