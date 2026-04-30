#!/usr/bin/env node

/**
 * MCP Metadata Setup Wizard
 * 
 * Configures Salesforce metadata files for your MCP server integration.
 * No dependencies required - uses only Node.js built-in modules.
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Configuration
// =============================================================================

/** Templates always ship next to this script (package root when published). */
const TEMPLATE_ROOT = join(__dirname, 'force-app', 'main', 'default');
const TEMPLATE_NAME = 'template';
const TEMPLATE_NAME_NOAUTH = 'template-noauth';
const MCP_PROTOCOL_VERSION = '2025-06-18';

const AUTH_TYPES = {
  OAUTH: 'OAuth',
  NO_AUTH: 'NoAuth',
};

const VARIABLES = [
  {
    key: 'MCP_NAME',
    prompt: 'MCP server name',
    description: 'A unique identifier for your MCP server (e.g., weatherApi, SlackMcp).\nOnly letters are allowed; no numbers or underscores.\nThis will be used for file names and labels in Salesforce.',
    validate: (val) => /^[a-zA-Z]+$/.test(val),
    error: 'Only letters (uppercase and/or lowercase) are allowed. No numbers or underscores.',
  },
  {
    key: 'MCP_SERVER_URL',
    prompt: 'MCP server URL',
    description: 'The full URL of your MCP server endpoint.\nExample: https://mcp.example.com/api',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with https://',
  },
  {
    key: 'AUTH_TYPE',
    prompt: 'Authentication type',
    description: 'How Salesforce should authenticate to your MCP server.',
    choices: [
      { value: AUTH_TYPES.OAUTH, label: 'OAuth 2.0 Client Credentials' },
      { value: AUTH_TYPES.NO_AUTH, label: 'No Authentication' },
    ],
    defaultValue: AUTH_TYPES.OAUTH,
  },
  {
    key: 'AUTH_PROVIDER_URL',
    prompt: 'OAuth token endpoint URL',
    description: 'The OAuth 2.0 token endpoint for authentication.\nExample: https://auth.example.com/oauth/token',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with https://',
    condition: (values) => values.AUTH_TYPE === AUTH_TYPES.OAUTH,
  },
  {
    key: 'NAMESPACE',
    prompt: 'Salesforce namespace (optional)',
    description: 'Your Salesforce namespace prefix, if applicable.\nLeave empty if you don\'t have a namespace.',
    validate: (val) => val === '' || /^[a-zA-Z][a-zA-Z0-9_]*$/.test(val),
    error: 'Must start with a letter and contain only letters, numbers, and underscores.',
    optional: true,
  },
];

const FILES = [
  {
    dir: 'externalCredentials',
    oldName: (authType) => `${authType === AUTH_TYPES.NO_AUTH ? TEMPLATE_NAME_NOAUTH : TEMPLATE_NAME}.externalCredential-meta.xml`,
    newName: (name) => `${name}.externalCredential-meta.xml`,
  },
  {
    dir: 'externalServiceRegistrations',
    oldName: () => `${TEMPLATE_NAME}.externalServiceRegistration-meta.xml`,
    newName: (name) => `${name}.externalServiceRegistration-meta.xml`,
  },
  {
    dir: 'namedCredentials',
    oldName: () => `${TEMPLATE_NAME}.namedCredential-meta.xml`,
    newName: (name) => `${name}.namedCredential-meta.xml`,
  },
  {
    dir: 'permissionsets',
    oldName: () => `${TEMPLATE_NAME}_Perm_Set.permissionset-meta.xml`,
    newName: (name) => `${name}_Perm_Set.permissionset-meta.xml`,
  },
];

/** True when this script lives under node_modules (npm / npx install). */
const isInstalledFromNpm = () => __dirname.replace(/\\/g, '/').includes('/node_modules/');

const parseCliArgs = (argv) => {
  const out = { target: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      out.help = true;
    }
    if (argv[i] === '--target' && argv[i + 1]) {
      out.target = resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return out;
};

/**
 * Directory where generated metadata is written.
 * From npm/npx: cwd/force-app/main/default. From a clone: same as templates unless --target is set.
 */
const resolveOutputRoot = (cli) => {
  if (cli.target) {
    const t = cli.target;
    if (existsSync(join(t, 'force-app', 'main', 'default'))) {
      return join(t, 'force-app', 'main', 'default');
    }
    if (existsSync(join(t, 'externalCredentials')) || existsSync(join(t, 'namedCredentials'))) {
      return t;
    }
    return join(t, 'force-app', 'main', 'default');
  }
  if (isInstalledFromNpm()) {
    return join(process.cwd(), 'force-app', 'main', 'default');
  }
  return join(__dirname, 'force-app', 'main', 'default');
};

// =============================================================================
// Colors (ANSI escape codes)
// =============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg) => console.log(`\n${c.blue}${'━'.repeat(70)}${c.reset}\n${c.bold}${c.cyan}  ${msg}${c.reset}\n${c.blue}${'━'.repeat(70)}${c.reset}\n`),
  success: (msg) => console.log(`${c.green}✔${c.reset}  ${msg}`),
  error: (msg) => console.log(`${c.red}✖${c.reset}  ${msg}`),
  warning: (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`),
  info: (msg) => console.log(`${c.cyan}ℹ${c.reset}  ${msg}`),
};

// =============================================================================
// Readline Interface
// =============================================================================

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (question) => new Promise((resolve) => rl.question(question, resolve));

const promptWithValidation = async (variable) => {
  console.log(`\n${c.bold}${variable.key}${c.reset}`);
  console.log(`${c.cyan}${variable.description}${c.reset}`);

  while (true) {
    const suffix = variable.optional ? ' (press Enter to skip)' : '';
    const answer = await prompt(`${c.green}▸${c.reset} ${variable.prompt}${suffix}: `);

    if (variable.validate(answer)) {
      return answer;
    }
    log.error(variable.error);
  }
};

const promptChoice = async (variable) => {
  console.log(`\n${c.bold}${variable.key}${c.reset}`);
  console.log(`${c.cyan}${variable.description}${c.reset}`);

  variable.choices.forEach((choice, idx) => {
    const marker = choice.value === variable.defaultValue ? ' (default)' : '';
    console.log(`  ${c.bold}${idx + 1}.${c.reset} ${choice.label}${marker}`);
  });

  const defaultIdx = variable.choices.findIndex((ch) => ch.value === variable.defaultValue);
  const defaultLabel = defaultIdx >= 0 ? `${defaultIdx + 1}` : '';

  while (true) {
    const suffix = defaultLabel ? ` [${defaultLabel}]` : '';
    const answer = (await prompt(`${c.green}▸${c.reset} ${variable.prompt}${suffix}: `)).trim();
    if (answer === '' && variable.defaultValue !== undefined) {
      return variable.defaultValue;
    }
    const num = Number.parseInt(answer, 10);
    if (Number.isInteger(num) && num >= 1 && num <= variable.choices.length) {
      return variable.choices[num - 1].value;
    }
    const matched = variable.choices.find((ch) => ch.value.toLowerCase() === answer.toLowerCase());
    if (matched) return matched.value;
    log.error(`Enter a number between 1 and ${variable.choices.length}.`);
  }
};

// =============================================================================
// File Operations
// =============================================================================

const applyReplacements = (content, replacements) => {
  let result = content;
  for (const [search, replace] of Object.entries(replacements)) {
    result = result.replaceAll(search, replace);
  }
  return result;
};

/** Copy template to new path with replacements applied. Leaves template unchanged. */
const copyFromTemplate = (templatePath, newPath, replacements) => {
  const content = readFileSync(templatePath, 'utf8');
  const newContent = applyReplacements(content, replacements);
  mkdirSync(dirname(newPath), { recursive: true });
  writeFileSync(newPath, newContent, 'utf8');
};

/** Returns true if any of the metadata files for this MCP_NAME already exist. */
const instanceExists = (mcpName, outputRoot) => {
  return FILES.some((file) => {
    const path = join(outputRoot, file.dir, file.newName(mcpName));
    return existsSync(path);
  });
};

/** Derive existing MCP instance names from externalCredentials dir (canonical source). */
const getExistingInstances = (outputRoot) => {
  const dir = join(outputRoot, 'externalCredentials');
  if (!existsSync(dir)) return [];
  const names = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.externalCredential-meta\.xml$/);
    if (match && match[1] !== TEMPLATE_NAME && match[1] !== TEMPLATE_NAME_NOAUTH) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
};

// =============================================================================
// XML escape and minimal schema/serviceBinding stubs
// =============================================================================

/** Escape a string for safe use inside XML element content. */
const escapeXml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/** Minimal schema stub when fetch is skipped or fails. */
const getMinimalSchema = (mcpName) => ({
  serverDescriptor: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: mcpName, version: '1.0.0' },
  },
  tools: [],
  resources: [],
});

/** Minimal serviceBinding stub when fetch is skipped or fails. */
const getMinimalServiceBinding = (mcpName) => ({
  protocolVersion: MCP_PROTOCOL_VERSION,
  serverInfo: { name: mcpName, version: '1.0.0' },
  instructions: null,
});

// =============================================================================
// OAuth and MCP client
// =============================================================================

/** Get OAuth 2.0 access token via client_credentials grant. Returns token string or null. */
const getOAuthToken = async (authProviderUrl, clientId, clientSecret) => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(authProviderUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token request failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token ?? null;
};

/** Send one JSON-RPC request to the MCP server. Returns result; throws on error. */
const mcpJsonRpc = async (url, method, params = {}, token = null) => {
  const id = Math.floor(Math.random() * 1e9);
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data.result;
};

/** Normalize a tool from tools/list to schema shape (name, title, description, inputSchema, annotations). */
const normalizeTool = (t) => ({
  name: t.name ?? '',
  title: t.title ?? null,
  description: t.description ?? null,
  inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  annotations: t.annotations ?? null,
});

/** Fetch schema and serviceBinding from MCP server. Returns { schema, serviceBinding } or null on failure. */
const fetchSchemaFromMcp = async (mcpServerUrl, authProviderUrl, clientId, clientSecret) => {
  let token = null;
  if (clientId && clientSecret) {
    try {
      token = await getOAuthToken(authProviderUrl, clientId, clientSecret);
      log.success('OAuth token obtained.');
    } catch (err) {
      log.warning(`OAuth failed: ${err.message}`);
      return null;
    }
  }

  try {
    const initParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-metadata-setup', version: '1.0.0' },
    };
    const initResult = await mcpJsonRpc(mcpServerUrl, 'initialize', initParams, token);
    const protocolVersion = initResult.protocolVersion ?? MCP_PROTOCOL_VERSION;
    const serverInfo = initResult.serverInfo ?? { name: 'mcp-server', version: '1.0.0' };
    const instructions = initResult.instructions ?? null;

    const serverDescriptor = { protocolVersion, serverInfo };
    const serviceBinding = { protocolVersion, serverInfo, instructions };

    let tools = [];
    let cursor = undefined;
    do {
      const params = cursor ? { cursor } : {};
      const listResult = await mcpJsonRpc(mcpServerUrl, 'tools/list', params, token);
      const list = listResult?.tools ?? [];
      tools = tools.concat(list.map(normalizeTool));
      cursor = listResult?.nextCursor ?? null;
    } while (cursor);

    let resources = [];
    try {
      let resCursor = undefined;
      do {
        const params = resCursor ? { cursor: resCursor } : {};
        const listResult = await mcpJsonRpc(mcpServerUrl, 'resources/list', params, token);
        const list = listResult?.resources ?? [];
        resources = resources.concat(list);
        resCursor = listResult?.nextCursor ?? null;
      } while (resCursor);
    } catch {
      resources = [];
    }

    const schema = { serverDescriptor, tools, resources };
    return { schema, serviceBinding };
  } catch (err) {
    log.warning(`MCP fetch failed: ${err.message}`);
    if (String(err.message).includes('401') && !token) {
      log.info('If your MCP server requires OAuth, provide Client ID and Client Secret and try again.');
    }
    return null;
  }
};

// =============================================================================
// Main
// =============================================================================

const main = async () => {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
MCP Metadata Setup — Salesforce MCP metadata wizard

Usage:
  node setup.mjs [options]
  npm create @mvogelgesang/sf-mcp-client-metadata@latest -- [options]

Options:
  --target <path>   SFDX project root, or path to force-app/main/default
  -h, --help        Show this message

When installed via npm/npx, files are written under the current directory’s
force-app/main/default/. When run from a clone, files default to this repo’s
force-app/main/default/ unless --target is set.
`);
    process.exit(0);
  }

  const outputRoot = resolveOutputRoot(cli);

  console.clear();
  log.header('MCP Metadata Setup Wizard');

  log.info(`Metadata output: ${outputRoot}`);

  console.log('This wizard will configure the Salesforce metadata files for your');
  console.log('Model Context Protocol (MCP) server integration.\n');
  console.log('You\'ll be prompted for the following values:');
  VARIABLES.forEach((v, i) => {
    const opt = v.optional ? ' (optional)' : '';
    console.log(`  ${c.bold}${i + 1}.${c.reset} ${v.key}${opt}`);
  });

  await prompt(`\n${c.yellow}Press Enter to continue or Ctrl+C to cancel...${c.reset}`);

  // Gather values
  log.header('Step 1: Configuration Values');

  const existing = getExistingInstances(outputRoot);
  if (existing.length > 0) {
    log.info(`Existing MCP instances: ${existing.join(', ')}`);
  }

  const values = {};
  for (const variable of VARIABLES) {
    if (variable.condition && !variable.condition(values)) continue;
    if (variable.choices) {
      values[variable.key] = await promptChoice(variable);
    } else {
      values[variable.key] = await promptWithValidation(variable);
    }
  }
  const authType = values.AUTH_TYPE ?? AUTH_TYPES.OAUTH;
  const isNoAuth = authType === AUTH_TYPES.NO_AUTH;

  // Optional: fetch schema and serviceBinding from MCP server
  log.header('Step 1b: Schema from MCP (optional)');
  console.log('The External Service Registration needs a schema (tools list) and service binding.\n');
  const fetchSchema = (await prompt(`${c.green}▸${c.reset} Fetch schema from MCP server now? (y/n): `)).trim().toLowerCase() === 'y';

  let schemaObj;
  let serviceBindingObj;
  let schemaSource = 'minimal stub';

  if (fetchSchema) {
    let clientId = '';
    let clientSecret = '';
    if (!isNoAuth) {
      clientId = (await prompt(`${c.green}▸${c.reset} Client ID (optional, if MCP requires OAuth): `)).trim();
      clientSecret = (await prompt(`${c.green}▸${c.reset} Client Secret (optional): `)).trim();
    } else {
      log.info('No Authentication selected — skipping OAuth credentials.');
    }
    log.info('Calling MCP server...');
    const result = await fetchSchemaFromMcp(
      values.MCP_SERVER_URL,
      values.AUTH_PROVIDER_URL ?? null,
      clientId || null,
      clientSecret || null,
    );
    if (result) {
      schemaObj = result.schema;
      serviceBindingObj = result.serviceBinding;
      schemaSource = `fetched (${schemaObj.tools?.length ?? 0} tools, ${schemaObj.resources?.length ?? 0} resources)`;
      log.success('Schema and service binding fetched from MCP server.');
    } else {
      log.warning('Using minimal schema stub. You can deploy and refresh tools in Agentforce later.');
      schemaObj = getMinimalSchema(values.MCP_NAME);
      serviceBindingObj = getMinimalServiceBinding(values.MCP_NAME);
    }
  } else {
    schemaObj = getMinimalSchema(values.MCP_NAME);
    serviceBindingObj = getMinimalServiceBinding(values.MCP_NAME);
  }

  const schemaJsonEscaped = escapeXml(JSON.stringify(schemaObj));
  const serviceBindingJsonEscaped = escapeXml(JSON.stringify(serviceBindingObj));

  // Build replacements map
  const namespacePrefix = values.NAMESPACE ? `${values.NAMESPACE}__` : '';
  const replacements = {
    'MCP_NAME': values.MCP_NAME,
    'MCP_SERVER_URL': values.MCP_SERVER_URL,
    'NAMESPACE__': namespacePrefix,
    'SCHEMA_JSON': schemaJsonEscaped,
    'SERVICE_BINDING_JSON': serviceBindingJsonEscaped,
  };
  if (values.AUTH_PROVIDER_URL) {
    replacements['AUTH_PROVIDER_URL'] = values.AUTH_PROVIDER_URL;
  }

  // Show summary
  log.header('Step 2: Review Configuration');

  const authTypeLabel = isNoAuth ? 'No Authentication' : 'OAuth 2.0 Client Credentials';

  console.log('Please review your configuration:\n');
  console.log(`  ${c.bold}MCP_NAME:${c.reset}          ${values.MCP_NAME}`);
  console.log(`  ${c.bold}MCP_SERVER_URL:${c.reset}    ${values.MCP_SERVER_URL}`);
  console.log(`  ${c.bold}AUTH_TYPE:${c.reset}         ${authTypeLabel}`);
  if (values.AUTH_PROVIDER_URL) {
    console.log(`  ${c.bold}AUTH_PROVIDER_URL:${c.reset} ${values.AUTH_PROVIDER_URL}`);
  }
  console.log(`  ${c.bold}NAMESPACE:${c.reset}         ${values.NAMESPACE || '(none)'}`);
  console.log(`  ${c.bold}Schema:${c.reset}            ${schemaSource}`);

  console.log(`\n${c.bold}Files to be written under:${c.reset} ${outputRoot}\n`);
  console.log(`${c.bold}Files to be updated:${c.reset}`);
  for (const file of FILES) {
    const templateFile = file.oldName(authType);
    console.log(`  • ${file.dir}/${templateFile}`);
    console.log(`    → ${file.dir}/${file.newName(values.MCP_NAME)}\n`);
  }
  
  const confirm = await prompt(`${c.yellow}Apply these changes? (y/n): ${c.reset}`);
  
  if (confirm.toLowerCase() !== 'y') {
    console.log('');
    log.warning('Setup cancelled. No changes were made.');
    rl.close();
    process.exit(0);
  }
  
  // Check for existing instance and confirm overwrite if needed
  if (instanceExists(values.MCP_NAME, outputRoot)) {
    const overwrite = await prompt(`${c.yellow}Metadata for '${values.MCP_NAME}' already exists. Overwrite? (y/n): ${c.reset}`);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('');
      log.warning('Setup cancelled. No changes were made.');
      rl.close();
      process.exit(0);
    }
  }

  // Apply changes (copy from template; templates are left unchanged for future runs)
  log.header('Step 3: Applying Changes');
  
  for (const file of FILES) {
    const templateFile = file.oldName(authType);
    const templatePath = join(TEMPLATE_ROOT, file.dir, templateFile);
    const newPath = join(outputRoot, file.dir, file.newName(values.MCP_NAME));

    if (!existsSync(templatePath)) {
      log.error(`Template not found: ${templateFile}`);
      continue;
    }

    copyFromTemplate(templatePath, newPath, replacements);
    log.success(`Created: ${file.newName(values.MCP_NAME)}`);
  }
  
  // Complete
  log.header('Setup Complete!');

  const permSetName = `${values.MCP_NAME}_Perm_Set`;

  console.log('Your MCP metadata files have been configured successfully.\n');
  console.log(`${c.bold}Next steps${c.reset} — run the Salesforce CLI from your SFDX project root`);
  console.log(`(the directory that contains \`force-app\`; metadata was written under:\n  ${outputRoot})\n`);
  const m = values.MCP_NAME;
  const deployOnlyNew = `sf project deploy start --metadata ExternalCredential:${m} --metadata NamedCredential:${m} --metadata ExternalServiceRegistration:${m} --metadata PermissionSet:${permSetName}`;
  console.log(`  ${c.bold}1)${c.reset} Deploy only the new MCP metadata to your org`);
  console.log(`     ${c.cyan}${deployOnlyNew}${c.reset}`);
  console.log('     (add --target-org <alias> if your default org is not set)\n');
  console.log(`  ${c.bold}2)${c.reset} Assign the MCP permission set to your user (or another user)`);
  console.log(`     ${c.cyan}sf org assign permset -n ${permSetName}${c.reset}\n`);
  console.log(`${c.bold}After deploy${c.reset} — finish MCP setup in Setup:`);
  if (isNoAuth) {
    console.log(`  • ${c.cyan}Setup → Named Credentials → External Credentials → ${values.MCP_NAME}${c.reset}`);
    console.log('    → No Authentication: nothing to configure on Principals.');
  } else {
    console.log(`  • ${c.cyan}Setup → Named Credentials → External Credentials → ${values.MCP_NAME}${c.reset}`);
    console.log('    → Principals → enter Client Id and Client Secret → Save');
  }
  console.log(`  • ${c.cyan}Setup → Agentforce Registry → ${values.MCP_NAME}${c.reset} → Edit tools if needed`);
  console.log('');
  log.success('Happy coding!');
  console.log('');
  
  rl.close();
};

main().catch((err) => {
  log.error(err.message);
  rl.close();
  process.exit(1);
});
