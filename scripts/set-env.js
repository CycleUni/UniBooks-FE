const fs = require('fs');
const path = require('path');

const envDir = path.join(__dirname, '../src/environments');

if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}

const envConfigFile = `
export const environment = {
  production: false,
  backendUrl: '${process.env.NG_APP_BACKEND_URL || 'http://127.0.0.1:8000/api/v1'}',
  gaMeasurementId: '${process.env.NG_APP_GA_MEASUREMENT_ID || ''}'
};
`;

const prodConfigFile = `
export const environment = {
  production: true,
  backendUrl: '${process.env.NG_APP_BACKEND_URL || 'http://127.0.0.1:8000/api/v1'}',
  gaMeasurementId: '${process.env.NG_APP_GA_MEASUREMENT_ID || ''}'
};
`;

function writeFile(filePath, content, label) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  console.log(`${label} generated at ${filePath}`);
}

writeFile(path.join(envDir, 'environment.ts'), envConfigFile, 'environment.ts');
writeFile(path.join(envDir, 'environment.prod.ts'), prodConfigFile, 'environment.prod.ts');

// Update angular.json allowedHosts if NG_APP_ALLOWED_HOSTS is provided
if (process.env.NG_APP_ALLOWED_HOSTS) {
  const angularJsonPath = path.join(__dirname, '../angular.json');
  try {
    let angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
    const hosts = process.env.NG_APP_ALLOWED_HOSTS.split(',').map(s => s.trim());
    const buildOptions = angularJson.projects['unibooks-fe'].architect.build.options;
    if (buildOptions.security) {
      buildOptions.security.allowedHosts = hosts;
      fs.writeFileSync(angularJsonPath, JSON.stringify(angularJson, null, 2), 'utf8');
      console.log(`Updated angular.json allowedHosts: ${hosts.join(', ')}`);
    }
  } catch (err) {
    console.error('Failed to update angular.json allowedHosts', err);
  }
}

// ---------------------------------------------------------------------------
// Content-Security-Policy
//
// The policy shipped in public/_headers is Report-Only and names two wildcard
// sources (img-src https:, connect-src https: wss:), because the R2 media
// domain and the CFEdgeChat origin differ per deployment and a static file
// cannot know them. A wildcard connect-src is most of the value of a CSP gone:
// it is exactly the directive that would stop an injected script posting
// stolen data to an attacker's server.
//
// So narrow it here, from the same environment that configures the app. When
// the origins below are supplied the CSP line is rewritten with real hosts,
// and NG_APP_CSP_ENFORCE=1 additionally promotes it from Report-Only to
// enforcing. With none of them set the committed file is left exactly as it
// is — a deploy that does not opt in keeps working, with every other security
// header intact.
//
// EDGE_CHAT_URL and R2_PUBLIC_URL deliberately carry no NG_APP_ prefix: they
// are the same values, in the same format, that Django is already configured
// with, so a whole KEY=VALUE line can be copied between the two dashboards
// rather than retyped under a second name. The prefix is kept only for
// settings that exist for the frontend alone (NG_APP_BACKEND_URL, which also
// carries the /api/v1 path the app calls; NG_APP_CSP_ENFORCE;
// NG_APP_GA_MEASUREMENT_ID).
// ---------------------------------------------------------------------------

function originOf(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    console.warn(`[set-env] ignoring unparseable URL for CSP: ${rawUrl}`);
    return null;
  }
}

// Directives that cost nothing to enforce, whatever the deployment: the app
// has no <object>/<embed>, no cross-origin <form action>, its <base> is the
// origin itself, and X-Frame-Options: DENY already says what frame-ancestors
// says. Enforcing these needs no verification pass and no opt-in, so a deploy
// that never sets NG_APP_CSP_ENFORCE still gets real protection instead of a
// policy that only ever watches. base-uri in particular is worth having: a
// injected <base> tag is a standard way to escalate an HTML injection into
// script execution.
const ALWAYS_ENFORCED = [
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function buildCsp({ backendOrigin, chatOrigin, mediaOrigin }) {
  const connect = ["'self'", backendOrigin, chatOrigin, chatOrigin && chatOrigin.replace(/^https:/, 'wss:'), 'https://*.r2.cloudflarestorage.com', 'https://accounts.google.com'];
  const img = ["'self'", 'data:', 'blob:', mediaOrigin, 'https://lh3.googleusercontent.com'];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://accounts.google.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src ${img.filter(Boolean).join(' ')}`,
    `connect-src ${connect.filter(Boolean).join(' ')}`,
    'frame-src https://accounts.google.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

const cspOrigins = {
  backendOrigin: originOf(process.env.NG_APP_BACKEND_URL),
  chatOrigin: originOf(process.env.EDGE_CHAT_URL),
  mediaOrigin: originOf(process.env.R2_PUBLIC_URL),
};

// Only rewrite once every origin the wildcards stand in for is known.
// Substituting a partial set would narrow the policy to something the app
// cannot actually run under.
if (cspOrigins.backendOrigin && cspOrigins.chatOrigin && cspOrigins.mediaOrigin) {
  const headersPath = path.join(__dirname, '../public/_headers');
  const headerName = process.env.NG_APP_CSP_ENFORCE === '1'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';
  const line = `  ${headerName}: ${buildCsp(cspOrigins)}`;


  const original = fs.readFileSync(headersPath, 'utf8');
  const lines = process.env.NG_APP_CSP_ENFORCE === '1'
    // Enforcing the full policy supersedes the always-enforced subset.
    ? [line]
    : [`  Content-Security-Policy: ${ALWAYS_ENFORCED}`, line];

  // Replace the whole CSP block: there may be one line or two, and which is
  // which changes with the flag.
  let replaced = false;
  const rewritten = original
    .split('\n')
    .flatMap(l => {
      if (!/^ {2}Content-Security-Policy(-Report-Only)?:/.test(l)) return [l];
      if (replaced) return [];
      replaced = true;
      return lines;
    })
    .join('\n');

  if (rewritten === original) {
    console.log('CSP unchanged');
  } else {
    fs.writeFileSync(headersPath, rewritten, { encoding: 'utf8' });
    console.log(`CSP rewritten in public/_headers (${headerName})`);
  }
} else {
  console.log('CSP left as committed — set NG_APP_BACKEND_URL, EDGE_CHAT_URL and R2_PUBLIC_URL to narrow it');
}
