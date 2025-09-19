const floorsContainer = document.getElementById('floorsContainer');
const refreshButton = document.getElementById('refreshButton');
const overlay = document.getElementById('overlay');
const modal = document.getElementById('reservationModal');
const closeModalButton = document.getElementById('closeModal');
const reservationForm = document.getElementById('reservationForm');
const reservationList = document.getElementById('reservationList');
const modalTitle = document.getElementById('modalTitle');
const tableMeta = document.getElementById('tableMeta');
const reservationTemplate = document.getElementById('reservationItemTemplate');

let appState = { tables: [] };
let currentTableId = null;
let autoRefreshTimer = null;

const STATUS_LABELS = {
  active: '待到店',
  arrived: '已到达',
  archived: '已归档',
  cancelled: '已取消',
};

async function fetchTables(showError = true) {
  try {
    const response = await fetch('/api/tables');
    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    const data = await response.json();
    appState.tables = data.tables || [];
    renderAll();
  } catch (error) {
    console.error(error);
    if (showError) {
      alert('加载桌位数据失败，请稍后重试。');
    }
  }
}

function renderAll() {
  renderFloors();

  if (currentTableId) {
    const table = appState.tables.find((item) => item.id === currentTableId);
    if (table) {
      populateModal(table);
    } else {
      closeModal();
    }
  }
}

function groupTablesByFloor() {
  const grouped = new Map();
  for (const table of appState.tables) {
    const list = grouped.get(table.floor) || [];
    list.push(table);
    grouped.set(table.floor, list);
  }
  return grouped;
}

function renderFloors() {
  const grouped = groupTablesByFloor();
  floorsContainer.innerHTML = '';
  const floorOrder = ['一楼', '二楼'];
  const floors = floorOrder.filter((floor) => grouped.has(floor)).concat(
    Array.from(grouped.keys()).filter((floor) => !floorOrder.includes(floor))
  );

  for (const floor of floors) {
    const section = document.createElement('section');
    section.className = 'floor-section';

    const title = document.createElement('h2');
    title.textContent = `${floor}`;
    const count = document.createElement('span');
    const tables = grouped.get(floor) || [];
    count.textContent = `共 ${tables.length} 桌`;
    title.appendChild(count);
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'table-grid';

    tables.forEach((table) => {
      const card = document.createElement('article');
      card.className = 'table-card';
      card.dataset.tableId = table.id;

      const colorMeta = computeCardColor(table.reservations || []);
      if (colorMeta) {
        card.style.background = colorMeta.background;
        card.style.borderColor = colorMeta.border;
      } else {
        card.style.background = 'white';
        card.style.borderColor = 'var(--border-color)';
      }

      const name = document.createElement('div');
      name.className = 'table-name';
      name.textContent = table.name;

      const seats = document.createElement('div');
      seats.className = 'table-seats';
      seats.textContent = `座位数：${table.seats}`;

      const next = document.createElement('div');
      next.className = 'next-reservation';
      const upcoming = getNextReservation(table.reservations || []);
      if (upcoming) {
        const diff = timeDiffText(upcoming.start_time);
        next.textContent = `${formatDateTime(upcoming.start_time)} · ${upcoming.guest_name} · ${diff}`;
      } else {
        next.textContent = '暂无预定';
      }

      card.appendChild(name);
      card.appendChild(seats);
      card.appendChild(next);

      card.addEventListener('click', () => openModal(table.id));

      grid.appendChild(card);
    });

    section.appendChild(grid);
    floorsContainer.appendChild(section);
  }
}

function computeCardColor(reservations) {
  const now = new Date();
  const activeReservations = (reservations || []).filter((res) => res.status === 'active');
  if (activeReservations.length === 0) {
    return null;
  }

  const withDates = activeReservations
    .map((res) => ({
      ...res,
      start: new Date(res.start_time),
    }))
    .filter((res) => !Number.isNaN(res.start.getTime()))
    .sort((a, b) => a.start - b.start);

  if (withDates.length === 0) {
    return null;
  }

  const next = withDates[0];
  const diffMs = next.start.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (diffMs > dayMs) {
    return { background: '#e8f5e9', border: '#4caf50' };
  }

  const ratio = Math.max(0, Math.min(1, diffMs / dayMs));
  const hue = ratio * 120; // 0 -> red, 120 -> green
  const background = `hsl(${hue}, 85%, 88%)`;
  const border = `hsl(${hue}, 65%, 52%)`;
  return { background, border };
}

function getNextReservation(reservations) {
  const now = new Date();
  const active = (reservations || [])
    .filter((res) => res.status === 'active')
    .map((res) => ({ ...res, start: new Date(res.start_time) }))
    .filter((res) => !Number.isNaN(res.start.getTime()))
    .sort((a, b) => a.start - b.start);
  if (active.length === 0) {
    return null;
  }
  const next = active.find((res) => res.start.getTime() >= now.getTime());
  return next || active[0];
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function timeDiffText(startTime) {
  const now = new Date();
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return '';
  }
  const diffMs = start.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  if (diffMinutes >= 60) {
    const hours = Math.round(diffMinutes / 60);
    return `还有${hours}小时`;
  }
  if (diffMinutes > 0) {
    return `还有${diffMinutes}分钟`;
  }
  if (diffMinutes > -15) {
    return '客人即将到店';
  }
  return '已过期等待归档';
}

function openModal(tableId) {
  const table = appState.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  currentTableId = tableId;
  populateModal(table);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
}

function closeModal() {
  currentTableId = null;
  overlay.classList.add('hidden');
  modal.classList.add('hidden');
}

function populateModal(table) {
  modalTitle.textContent = `${table.name}`;
  tableMeta.innerHTML = `
    <div>楼层：${table.floor}</div>
    <div>座位数：${table.seats}</div>
    <div>当前预定：${(table.reservations || []).filter((res) => res.status === 'active').length} 条</div>
  `;

  reservationForm.reset();
  reservationForm.elements.table_id.value = table.id;
  reservationForm.elements.party_size.value = table.seats;
  setDefaultReservationTime(reservationForm.elements.start_time);

  renderReservationList(table);
}

function setDefaultReservationTime(input) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30 - (now.getMinutes() % 30));
  now.setSeconds(0, 0);
  const tzOffset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - tzOffset * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  input.value = local;
}

function renderReservationList(table) {
  reservationList.innerHTML = '';
  const reservations = table.reservations || [];
  if (reservations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '暂无预定记录。';
    reservationList.appendChild(empty);
    return;
  }

  const active = reservations.filter((res) => res.status === 'active');
  const others = reservations.filter((res) => res.status !== 'active');

  const ordered = [
    ...active.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
    ...others.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)),
  ];

  ordered.forEach((reservation) => {
    const node = reservationTemplate.content.cloneNode(true);
    const timeEl = node.querySelector('.reservation-time');
    const guestEl = node.querySelector('.reservation-guest');
    const metaEl = node.querySelector('.reservation-meta');
    const actionsEl = node.querySelector('.reservation-actions');

    timeEl.textContent = formatDateTime(reservation.start_time);
    guestEl.textContent = `${reservation.guest_name}（${reservation.phone}）`;
    const noteText = reservation.notes ? `备注：${reservation.notes}` : '无备注';
    metaEl.textContent = `人数：${reservation.party_size} · ${noteText}`;

    actionsEl.innerHTML = '';
    if (reservation.status === 'active') {
      const now = new Date();
      const start = new Date(reservation.start_time);

      if (start.getTime() <= now.getTime()) {
        const arriveBtn = document.createElement('button');
        arriveBtn.textContent = '已到达';
        arriveBtn.addEventListener('click', () => handleArrived(reservation.id));
        actionsEl.appendChild(arriveBtn);
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消预定';
      cancelBtn.classList.add('danger');
      cancelBtn.addEventListener('click', () => handleCancel(reservation.id));
      actionsEl.appendChild(cancelBtn);
    } else {
      const status = document.createElement('span');
      status.className = 'status-chip';
      status.textContent = STATUS_LABELS[reservation.status] || reservation.status;
      actionsEl.appendChild(status);
    }

    reservationList.appendChild(node);
  });
}

async function handleArrived(reservationId) {
  if (!confirm('确认标记为已到达吗？')) {
    return;
  }
  try {
    const response = await fetch(`/api/reservations/${reservationId}/arrive`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || '标记失败');
    }
    await fetchTables(false);
  } catch (error) {
    alert(error.message);
  }
}

async function handleCancel(reservationId) {
  if (!confirm('确定取消该预定吗？')) {
    return;
  }
  try {
    const response = await fetch(`/api/reservations/${reservationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || '取消失败');
    }
    await fetchTables(false);
  } catch (error) {
    alert(error.message);
  }
}


reservationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(reservationForm);
  const payload = Object.fromEntries(formData.entries());
  payload.party_size = Number(payload.party_size);
  try {
    const response = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || '保存失败');
    }
    await fetchTables(false);
  } catch (error) {
    alert(error.message);
  }
});

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  autoRefreshTimer = setInterval(() => fetchTables(false), 60000);
}

fetchTables();
startAutoRefresh();
