// Thin wrappers around @devvit/web/client so the game also runs in a plain browser (tools/preview.mjs).
import { showToast, showLoginPrompt, requestExpandedMode, showShareSheet } from '@devvit/web/client';

export function toast(text: string): void {
  try {
    showToast(text);
  } catch {
    fallbackToast(text);
  }
}

function fallbackToast(text: string): void {
  let el = document.getElementById('fallback-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fallback-toast';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:999px;font:600 14px system-ui;z-index:99;box-shadow:0 4px 14px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => (el!.style.display = 'none'), 2200);
}

export function promptLogin(): void {
  try {
    showLoginPrompt();
  } catch {
    toast('Log in to Reddit to save your streak');
  }
}

export function expand(e: MouseEvent): void {
  try {
    requestExpandedMode(e, 'game');
  } catch {
    // Outside Reddit (preview server): just open the game page.
    window.location.href = 'game.html';
  }
}

export async function share(text: string): Promise<boolean> {
  try {
    await showShareSheet({ title: 'Gridlock Daily', text });
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
