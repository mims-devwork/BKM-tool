const { app } = require('@azure/functions');

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT; // e.g. https://bkm-generator-resource.openai.azure.com/openai/v1

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function getCallerInfo(request) {
    // Easy Auth sets this header with base64-encoded user claims
    const principal = request.headers.get('x-ms-client-principal');
    if (!principal) return 'unauthenticated';
    try {
        const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
        const claims  = decoded.claims || [];
        const email   = claims.find(c => c.typ === 'preferred_username')?.val;
        const name    = claims.find(c => c.typ === 'name')?.val;
        return `${name || 'unknown'} <${email || 'unknown'}>`;
    } catch {
        return 'unknown';
    }
}

app.http('generate', {
    methods:   ['POST', 'OPTIONS'],
    authLevel: 'anonymous',  // auth enforced by Easy Auth configured in Azure Portal
    route:     'generate',
    handler:   async (request, context) => {
        if (request.method === 'OPTIONS') {
            return { status: 204, headers: CORS_HEADERS };
        }

        // Easy Auth blocks unauthenticated requests before they reach here (returns 401).
        // This check is a fallback for local dev or misconfiguration.
        const principal = request.headers.get('x-ms-client-principal');
        if (!principal) {
            return {
                status:  401,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ error: { message: 'Unauthorized' } })
            };
        }

        const caller = getCallerInfo(request);
        context.log(`[generate] called by ${caller}`);

        if (!OPENAI_API_KEY || !OPENAI_ENDPOINT) {
            context.error('[generate] missing OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT env vars');
            return {
                status:  500,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ error: { message: 'Function is not configured correctly. Contact the admin.' } })
            };
        }

        try {
            const reqBody  = await request.text();
            const upstream = await fetch(`${OPENAI_ENDPOINT}/chat/completions`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': OPENAI_API_KEY },
                body:    reqBody
            });

            if (!upstream.ok) {
                const err = await upstream.text();
                context.error(`[generate] upstream error ${upstream.status}:`, err);
                return {
                    status:  upstream.status,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                    body:    err
                };
            }

            // Pass the SSE stream straight through to the browser
            return new Response(upstream.body, {
                status:  200,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type':  upstream.headers.get('Content-Type') || 'text/event-stream',
                    'Cache-Control': 'no-cache'
                }
            });
        } catch (err) {
            context.error('[generate] error:', err);
            return {
                status:  500,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ error: { message: err.message } })
            };
        }
    }
});
