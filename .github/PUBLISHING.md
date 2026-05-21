# Publishing the Jira Ticket Classifier Extension

This document explains how to publish updates to the Jira Ticket Classifier extension.

## Prerequisites

1. **VS Code Marketplace Account**: Register at https://marketplace.visualstudio.com
2. **OpenVSX Account** (Optional): Register at https://open-vsx.org for broader Linux/non-VS-Code editor support
3. **GitHub Secrets Configured**: Set up API tokens in the repository settings

## Setup

### 1. Update package.json Publisher

Update the `publisher` field in `package.json` with your publisher name:

```json
{
  "publisher": "your-actual-publisher-name"
}
```

### 2. Create VS Code Marketplace Token

1. Go to https://marketplace.visualstudio.com/manage
2. Click "Create Publisher" or use an existing publisher
3. In publisher settings, create a Personal Access Token (PAT)
4. Copy the token

### 3. Create OpenVSX Token (Optional)

1. Go to https://open-vsx.org
2. Create an account
3. Go to user settings and generate a token

### 4. Configure GitHub Secrets

In your GitHub repository:

1. Go to Settings → Secrets and variables → Actions
2. Create `VSCE_TOKEN` with the VS Code Marketplace PAT
3. Create `OVSX_TOKEN` with the OpenVSX PAT (optional)

## Publishing Process

### Automatic Publishing (Recommended)

1. Update the version in `package.json`:
   ```bash
   npm version minor  # or patch/major
   ```

2. Push the changes:
   ```bash
   git push origin main
   git push origin --tags
   ```

3. Create a GitHub Release:
   - Go to https://github.com/yegecali/jira-ticket-support-vscode/releases
   - Click "Draft a new release"
   - Select the tag you just created
   - Add release notes
   - Click "Publish release"

The `publish.yml` workflow will automatically:
- Run tests and linting
- Package the extension
- Publish to VS Code Marketplace
- Attempt to publish to OpenVSX (if token is configured)

### Manual Publishing

If you need to publish manually:

1. Install VSCE:
   ```bash
   npm install -g @vscode/vsce ovsx
   ```

2. Login to marketplace:
   ```bash
   vsce login your-publisher-name
   ```

3. Publish:
   ```bash
   npm run vscode:prepublish
   npm run compile
   vsce publish
   ```

## Workflows

### CI Workflow (`ci.yml`)
- Runs on: Push to main/develop, Pull requests
- Performs: Linting, compilation, testing
- Artifacts: Packages extension as .vsix file

### Publish Workflow (`publish.yml`)
- Triggers: On GitHub release creation
- Performs: Full test suite, then publishes to marketplaces
- Requires: `VSCE_TOKEN` and optionally `OVSX_TOKEN` secrets

### CodeQL Workflow (`codeql.yml`)
- Runs: On push to main, pull requests, weekly schedule
- Performs: Security analysis on TypeScript code

## Troubleshooting

### "Publisher identity not found"
- Ensure `publisher` field in package.json matches your marketplace publisher ID
- Run `vsce show-versions` to verify your version

### "Authentication failed"
- Verify `VSCE_TOKEN` is correctly set in GitHub secrets
- Check the token hasn't expired on the marketplace

### Extension not appearing in marketplace
- Wait 15-30 minutes for indexing after publish
- Check marketplace for your publisher name
- Verify extension UUID (id in frontmatter) is unique

## Versioning

Follow semantic versioning:
- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

Use `npm version` to update automatically:
```bash
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.0 → 0.2.0
npm version major  # 0.1.0 → 1.0.0
```

## Resources

- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VSCE CLI Reference](https://github.com/microsoft/vscode-vsce)
- [OpenVSX Publishing](https://github.com/EclipseFdn/open-vsx/wiki/Publishing-Extensions)
