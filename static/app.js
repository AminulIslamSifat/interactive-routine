// Interactive Routine Planner — vanilla JS, no deps
const API = '/api/items';
const listEl = document.getElementById('routine-list');
const form = document.getElementById('add-form');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');

let items = [];

// --- API helpers ---
async function fetchItems() {
  const res = await fetch(API);
  items = await res.json();
  render();
}

async function addItem(item) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  const created = await res.json();
  items.push(created);
  render();
}

async function updateItem(id, patch) {
  await fetch(`${API}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  Object.assign(items.find(i => i.id === id), patch);
  render();
}

async function deleteItem(id) {
  await fetch(`${API}/${id}`, { method: 'DELETE' });
  items = items.filter(i => i.id !== id);
  render();
}

async function reorderItems(newOrder) {
  // Update order field and batch-save
  newOrder.forEach((id, idx) => {
    const item = items.find(i => i.id === id);
    if (item) item.order = idx;
  });
  // Sort local array
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Persist each (simple approach; could be batch endpoint)
  for (const item of items) {
    await fetch(`${API}/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: item.order }),
    });
  }
  render();
}

// --- Rendering ---
function render() {
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (items.length === 0) {
    listEl.innerHTML = '<li class="empty">No tasks yet. Add one above ✨</li>';
    updateProgress();
    return;
  }

  listEl.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = `item${item.done ? ' done' : ''}`;
    li.draggable = true;
    li.dataset.id = item.id;

    li.innerHTML = `
      <span class="cat-dot cat-${item.category || 'work'}"></span>
      <span class="time-label">${item.time || '--:--'}</span>
      <span class="task-text">${escapeHtml(item.task)}</span>
      <button class="check-btn" title="Toggle done">✓</button>
      <button class="del-btn" title="Delete">×</button>
    `;

    li.querySelector('.check-btn').onclick = () =>
      updateItem(item.id, { done: !item.done });
    li.querySelector('.del-btn').onclick = () => deleteItem(item.id);

    // Drag events
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover', onDragOver);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop', onDrop);
    li.addEventListener('dragend', onDragEnd);

    listEl.appendChild(li);
  });

  updateProgress();
}

function updateProgress() {
  const total = items.length;
  const done = items.filter(i => i.done).length;
  progressText.textContent = `${done}/${total} done`;
  progressFill.style.width = total ? `${(done / total) * 100}%` : '0%';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Drag & Drop reorder ---
let dragId = null;

function onDragStart(e) {
  dragId = +this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  if (+this.dataset.id === dragId) return;
  this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const targetId = +this.dataset.id;
  if (dragId === null || dragId === targetId) return;

  const ids = items.map(i => i.id);
  const fromIdx = ids.indexOf(dragId);
  const toIdx = ids.indexOf(targetId);
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, dragId);
  reorderItems(ids);
}

function onDragEnd() {
  dragId = null;
  document.querySelectorAll('.item').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}

// --- Form submit ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const time = document.getElementById('inp-time').value;
  const task = document.getElementById('inp-task').value.trim();
  const category = document.getElementById('inp-cat').value;
  if (!task) return;

  await addItem({
    time,
    task,
    category,
    done: false,
    order: items.length,
  });

  form.reset();
});

// --- Init ---
fetchItems();
