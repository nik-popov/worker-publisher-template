import Cloudflare from "cloudflare";

// Declare puppeteer global to fix TypeScript error
declare const puppeteer: {
  launch: (browser: any) => Promise<{
    newPage: () => Promise<{
      goto: (url: string, options: { waitUntil?: string; timeout?: number }) => Promise<void>;
      content: () => Promise<string>;
      setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
      evaluate: (script: string | Function) => Promise<any>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  }>;
};

async function deploySnippetToNamespace(
  opts: {
    namespaceName: string;
    scriptName: string;
    code: string;
    bindings?: Array<
      | { type: "plain_text"; name: string; text: string }
      | { type: "kv_namespace"; name: string; namespace_id: string }
      | { type: "r2_bucket"; name: string; bucket_name: string }
      | { type: "browser"; name: string }
    >;
  },
  env: {
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_ACCOUNT_ID: string;
  },
) {
  const { namespaceName, scriptName, code, bindings = [] } = opts;

  const cf = new Cloudflare({
    apiToken: env.CLOUDFLARE_API_TOKEN,
  });

  try {
    await cf.workersForPlatforms.dispatch.namespaces.get(namespaceName, {
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
    });
  } catch {
    await cf.workersForPlatforms.dispatch.namespaces.create({
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      name: namespaceName,
    });
  }

  const moduleFileName = `${scriptName}.mjs`;

  bindings.push({ type: "browser", name: "BROWSER" });

  await cf.workersForPlatforms.dispatch.namespaces.scripts.update(
    namespaceName,
    scriptName,
    {
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      metadata: {
        main_module: moduleFileName,
        bindings,
      },
      files: {
        [moduleFileName]: new File([code], moduleFileName, {
          type: "application/javascript+module",
        }),
      },
    },
  );

  return { namespace: namespaceName, script: scriptName };
}

const HTML_UI = ({ isReadOnly }: { isReadOnly: boolean }) => `<!DOCTYPE html>
<html>
<head>
  <title>Worker Publisher</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>&#x1F680;</text></svg>">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #fef7ed; color: #1a1a1a; line-height: 1.6; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 3rem; font-weight: 900; color: #1a1a1a; text-shadow: 4px 4px 0px #fb923c; margin-bottom: 2rem; text-transform: uppercase; letter-spacing: -0.02em; }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem; color: #1a1a1a; text-transform: uppercase; letter-spacing: 0.05em; }
    input, textarea { width: 100%; padding: 1rem; border: 4px solid #1a1a1a; background: white; font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 1rem; box-shadow: 8px 8px 0px #fb923c; transition: all 0.1s ease; }
    input:focus, textarea:focus { outline: none; transform: translate(-2px, -2px); box-shadow: 12px 12px 0px #fb923c; }
    textarea { height: 300px; resize: vertical; }
    button { background: #fb923c; color: #1a1a1a; border: 4px solid #1a1a1a; padding: 1rem 2rem; font-weight: 900; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; box-shadow: 8px 8px 0px #1a1a1a; transition: all 0.1s ease; font-family: inherit; }
    button:hover { transform: translate(-2px, -2px); box-shadow: 12px 12px 0px #1a1a1a; }
    button:active { transform: translate(2px, 2px); box-shadow: 4px 4px 0px #1a1a1a; }
    button:disabled { background: #9ca3af; color: #6b7280; cursor: not-allowed; box-shadow: 4px 4px 0px #6b7280; }
    button:disabled:hover { transform: none; box-shadow: 4px 4px 0px #6b7280; }
    .result { margin-top: 2rem; padding: 1.5rem; border: 4px solid #1a1a1a; background: white; box-shadow: 8px 8px 0px #fb923c; font-weight: 600; }
    .result.success { background: #dcfce7; border-color: #166534; box-shadow: 8px 8px 0px #22c55e; }
    .result.error { background: #fef2f2; border-color: #dc2626; box-shadow: 8px 8px 0px #ef4444; }
    .result a { color: #fb923c; font-weight: 900; text-decoration: none; border-bottom: 3px solid #fb923c; }
    .result a:hover { background: #fb923c; color: #1a1a1a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Worker Publisher</h1>
    <form id="deployForm">
      <div class="form-group">
        <label for="scriptName">Script Name</label>
        <input type="text" id="scriptName" placeholder="my-worker" required>
      </div>
      <div class="form-group">
        <label for="code">Worker Code</label>
        <textarea id="code">export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let browser;
    try {
      browser = await puppeteer.launch(await env.BROWSER.getBrowser());
      const page = await browser.newPage();

      const authToken = env.AUTH_TOKEN || '';
      if (authToken) {
        await page.setExtraHTTPHeaders({ 'Authorization': authToken });
      }

      await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      const html = await page.content();
      await browser.close();

      return new Response(JSON.stringify({ html, url: targetUrl }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      if (browser) await browser.close();
      return new Response(JSON.stringify({ error: error.message, url: targetUrl }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};</textarea>
      </div>
      <button type="submit"${isReadOnly ? " disabled" : ""}>Deploy Worker</button>
    </form>
    ${isReadOnly ? '<div class="result error">Deployment is disabled in read-only mode</div>' : ""}
    <div id="result"></div>
  </div>
  <script>
    const isReadOnly = ${isReadOnly};
    document.getElementById('deployForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const scriptName = document.getElementById('scriptName').value;
      const code = document.getElementById('code').value;
      const resultDiv = document.getElementById('result');

      resultDiv.innerHTML = '<div style="font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em;">Deploying...</div>';

      try {
        const response = await fetch('/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptName, code })
        });

        const result = await response.json();

        if (response.ok) {
          resultDiv.innerHTML = \`<div class="result success">Successfully deployed worker "\${result.script}"! Redirecting...</div>\`;
          setTimeout(() => {
            window.location.href = '/' + result.script;
          }, 2000);
        } else {
          resultDiv.innerHTML = \`<div class="result error">Error: \${result.error}</div>\`;
        }
      } catch (error) {
        resultDiv.innerHTML = \`<div class="result error">Error: \${error.message}</div>\`;
      }
    });
  </script>
</body>
</html>`;

export default {
  async fetch(
    request: Request,
    env: {
      CLOUDFLARE_API_TOKEN: string;
      CLOUDFLARE_ACCOUNT_ID: string;
      DISPATCHER: any;
      READONLY: string | boolean;
      BROWSER: any;
      AUTH_TOKEN?: string;
    },
  ) {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const isReadOnly = env.READONLY === "true" || env.READONLY === true;

    // Handle UI route
    if (pathSegments.length === 0) {
      return new Response(HTML_UI({ isReadOnly }), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle Browser Rendering endpoint (/render)
    if (pathSegments[0] === "render") {
      if (request.method === "GET") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return await renderPage(targetUrl, env);
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { url, waitUntil = "networkidle0", timeout = 30000, script } = body;
          if (!url) {
            return new Response(JSON.stringify({ error: "Missing url in JSON body" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          return await renderPage(url, env, { waitUntil, timeout, script });
        } catch (error) {
          return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    // Handle deploy endpoint
    if (pathSegments[0] === "deploy" && request.method === "POST") {
      if (isReadOnly) {
        return new Response(
          JSON.stringify({ error: "Read-only mode enabled" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      try {
        const { scriptName, code } = await request.json();
        if (!scriptName || !code) {
          return new Response(
            JSON.stringify({ error: "Missing scriptName or code" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const result = await deploySnippetToNamespace(
          {
            namespaceName: "my-dispatch-namespace",
            scriptName,
            code,
          },
          env,
        );

        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Handle worker dispatch
    const workerName = pathSegments[0];
    try {
      const worker = env.DISPATCHER.get(workerName);
      return await worker.fetch(request);
    } catch (e) {
      if (e.message.startsWith("Worker not found")) {
        return new Response(`Worker '${workerName}' not found`, {
          status: 404,
        });
      }
      return new Response("Internal error", { status: 500 });
    }
  },
};

async function renderPage(
  targetUrl: string,
  env: { BROWSER: any; AUTH_TOKEN?: string },
  options: { waitUntil?: string; timeout?: number; script?: string } = {},
) {
  const { waitUntil = "networkidle0", timeout = 30000, script } = options;
  let browser;

  try {
    browser = await puppeteer.launch(await env.BROWSER.getBrowser());
    const page = await browser.newPage();

    const authToken = env.AUTH_TOKEN || "";
    if (authToken) {
      await page.setExtraHTTPHeaders({ Authorization: authToken });
    }

    await page.goto(targetUrl, { waitUntil, timeout });

    let scriptResult = null;
    if (script) {
      scriptResult = await page.evaluate(script);
    }

    const html = await page.content();
    await browser.close();

    return new Response(JSON.stringify({ html, scriptResult, url: targetUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (browser) await browser.close();
    return new Response(JSON.stringify({ error: error.message, url: targetUrl }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}