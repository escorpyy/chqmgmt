// ============================================================================
// Drawer
// ============================================================================
import { initBsDatePickers } from './bsDatePicker.js';

export function openDrawer(html) {
  const content = document.getElementById('drawer-content');
  content.innerHTML = html;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  initBsDatePickers(content);
}

export function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
  setTimeout(() => { document.getElementById('drawer-content').innerHTML = ''; }, 250);
}

document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
