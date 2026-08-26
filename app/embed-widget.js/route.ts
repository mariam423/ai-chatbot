import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

/** Public loader used by the generated script embed snippet. */
export async function GET() {
  const script = `(() => {
  const current = document.currentScript;
  if (!current) return;
  const agentId = current.dataset.agentId;
  const token = current.dataset.token;
  if (!agentId || !token) return;
  const frame = document.createElement('iframe');
  const base = new URL(current.src).origin;
  frame.src = base + '/embed/' + encodeURIComponent(agentId) + '?token=' + encodeURIComponent(token);
  frame.title = current.dataset.title || 'AI assistant';
  frame.loading = 'lazy';
  frame.allow = 'microphone';
  frame.style.cssText = 'display:block;width:100%;height:600px;border:0;border-radius:16px;overflow:hidden;background:#0a0f0d';
  const container = document.createElement('div');
  container.setAttribute('data-chatbot-embed', agentId);
  container.appendChild(frame);
  current.parentNode?.insertBefore(container, current.nextSibling);
})();`
  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
