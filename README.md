# MCP Metadata for Salesforce (Closed Beta)

This repository contains Salesforce metadata templates for integrating a Model Context Protocol (MCP) server with Salesforce using Named Credentials and External Services.

The following metadata will only work for MCP Client Beta participants.

## What's Included

- **External Credential** — choose one of two authentication types:
  - **OAuth 2.0 Client Credentials** (default)
  - **No Authentication** — for public/unauthenticated MCP servers
- **Named Credential** - Secure endpoint configuration for your MCP server
- **External Service Registration** - MCP service registration
- **Permission Set** - Access permissions for the external credential

## Prerequisites

- Node.js 18+ installed
- Salesforce CLI (`sf`) installed
- A Salesforce org with API access
- Your MCP server details:
  - Server URL
  - For OAuth servers only: OAuth token endpoint URL, Client ID, and Client Secret

## Quick Start (recommended — no clone)

From the root of your existing SFDX project (where `sfdx-project.json` or `sf-project.json` lives):

```bash
npm create @mvogelgesang/sf-mcp-client-metadata@latest
```

The wizard writes metadata under `./force-app/main/default/` in your **current working directory**. Run the command from your project root so files land in the right place.

### Options

Pass flags after `--` (required by npm so they are forwarded to the generator):

```bash
npm create @mvogelgesang/sf-mcp-client-metadata@latest -- --target ./packages/my-app
```

- **`--target <path>`** — SFDX project root (must contain `force-app/main/default`), or a path that already is `force-app/main/default`, or a directory that contains `externalCredentials` / `namedCredentials` as direct children (treated as the `default` metadata folder).

```bash
node setup.mjs --help
```

## Quick Start (clone this repo)

```bash
git clone <repository-url>
cd mcpMetadata
node setup.mjs
```

From a clone, output defaults to this repository’s `force-app/main/default/`. Use `--target` to write somewhere else.

### Developing the generator locally

```bash
git clone <repository-url>
cd mcpMetadata
npm link
cd /path/to/your-sfdx-project
npm create @mvogelgesang/sf-mcp-client-metadata
```

Or run the script directly from the clone:

```bash
node setup.mjs
```

## Publishing (package maintainers)

This repo is published as **`@mvogelgesang/create-sf-mcp-client-metadata`**. Users run **`npm create @mvogelgesang/sf-mcp-client-metadata`**, which installs that package and executes its `bin`.

1. Bump the `"version"` field in [`package.json`](package.json).
2. Authenticate to npm (`npm login`) with access to the `@mvogelgesang` scope.
3. From the repository root:

   ```bash
   npm publish --access public
   ```

4. Verify with a clean install:

   ```bash
   npm create @mvogelgesang/sf-mcp-client-metadata@latest
   ```

`package.json` uses `"files": ["setup.mjs", "force-app"]` so only the wizard and templates are published.

The interactive wizard will prompt you for:

| Variable | Description | Example |
|----------|-------------|---------|
| `MCP_NAME` | Unique identifier for your MCP server (letters only) | `weatherApi` |
| `MCP_SERVER_URL` | Your MCP server endpoint URL | `https://mcp.example.com/api` |
| `AUTH_TYPE` | Authentication type — `OAuth 2.0 Client Credentials` or `No Authentication` | `OAuth 2.0 Client Credentials` |
| `AUTH_PROVIDER_URL` | OAuth 2.0 token endpoint (only when `AUTH_TYPE` is OAuth) | `https://auth.example.com/oauth/token` |
| `NAMESPACE` | Salesforce namespace (optional) | `mycompany` |

## Deploy and assign permission set

From your SFDX project root, deploy **only** the MCP components the wizard created (not the whole `force-app` tree):

```bash
sf project deploy start \
  --metadata "ExternalCredential:<MCP_NAME>" \
  --metadata "NamedCredential:<MCP_NAME>" \
  --metadata "ExternalServiceRegistration:<MCP_NAME>" \
  --metadata "PermissionSet:<MCP_NAME>_Perm_Set"
sf org assign permset -n <MCP_NAME>_Perm_Set
```

Replace `<MCP_NAME>` with the name you entered in the wizard (for example `weatherApi` → `ExternalCredential:weatherApi` … and permission set `weatherApi_Perm_Set`).

Add `--target-org <alias>` to the deploy command if your default scratch org or sandbox is not already selected.

## Activate MCP Server Connection

### OAuth 2.0 Client Credentials

1. [Workaround] Go to **Setup → Named Credentials → {MCP Server Name} → Click through to the External Credential
2. Scroll down to Principals → Edit → Enter Client Id and Secret → Save
3. Go to **Setup → Agentforce Registry → {MCP Server Name} → Edit
4. Leave content in modal as is → Save and Continue
5. Under Tools tab, Click Edit Tools. Full tool list will refresh

### No Authentication

No client credentials are required. The wizard generates an External Credential with `authenticationProtocol = NoAuthentication`.

1. Go to **Setup → Agentforce Registry → {MCP Server Name} → Edit
2. Leave content in modal as is → Save and Continue
3. Under Tools tab, Click Edit Tools. Full tool list will refresh

## File Structure

```
force-app/main/default/
├── externalCredentials/
│   └── <MCP_NAME>.externalCredential-meta.xml
├── externalServiceRegistrations/
│   └── <MCP_NAME>.externalServiceRegistration-meta.xml
├── namedCredentials/
│   └── <MCP_NAME>.namedCredential-meta.xml
└── permissionsets/
    └── <MCP_NAME>_Perm_Set.permissionset-meta.xml
```

## Configuration Variables

The setup script replaces the following placeholders:

| Placeholder | Description |
|-------------|-------------|
| `MCP_NAME` | Used in labels, API names, and file names |
| `MCP_SERVER_URL` | The MCP server endpoint URL |
| `AUTH_PROVIDER_URL` | OAuth token endpoint for authentication (OAuth auth type only) |
| `NAMESPACE__` | Namespace prefix for managed package references (empty if no namespace) |

## License

Apache License Version 2.0
