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
const openAdminButton = document.getElementById('openAdmin');
const clearReservationsButton = document.getElementById('clearReservations');
const formStatus = document.getElementById('formStatus');
const cancelEditButton = document.getElementById('cancelEdit');
const startTimeInput = reservationForm ? reservationForm.elements.start_time : null;
const reservationIdInput = reservationForm ? reservationForm.elements.reservation_id : null;

let appState = { tables: [] };
let currentTableId = null;
let autoRefreshTimer = null;
let formPristine = true;

if (reservationForm) {
  reservationForm.dataset.mode = 'create';
}

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
    updateToolbarState();
  } catch (error) {
    console.error(error);
    if (showError) {
      alert('加载桌位数据失败，请稍后重试。');
    }
  }
}

if (openAdminButton) {
  openAdminButton.addEventListener('click', () => {
    window.location.href = '/admin';
  });
}

if (clearReservationsButton) {
  clearReservationsButton.addEventListener('click', async () => {
    const total = getTotalReservations();
    if (total === 0) {
      alert('当前没有任何预定。');
      return;
    }
    const confirmed = confirm(`确认清除全部 ${total} 条预定信息？该操作不可撤销。`);
    if (!confirmed) {
      return;
    }
    try {
      const response = await fetch('/api/reservations', { method: 'DELETE' });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '清除失败');
      }
      await fetchTables(false);
    } catch (error) {
      alert(error.message);
    }
  });
}

if (closeModalButton) {
  closeModalButton.addEventListener('click', () => {
    closeModal();
  });
}

if (overlay) {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });
}

if (cancelEditButton) {
  cancelEditButton.addEventListener('click', () => {
    const table = appState.tables.find((item) => item.id === currentTableId);
    if (table) {
      setCreateDefaults(table);
      populateModal(table);
    }
  });
}

if (reservationForm) {
  reservationForm.addEventListener('input', () => {
    formPristine = false;
  });
  reservationForm.addEventListener('change', () => {
    formPristine = false;
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
    closeModal();
  }
});

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

function getTotalReservations() {
  return appState.tables.reduce((total, table) => {
    return total + (table.reservations ? table.reservations.length : 0);
  }, 0);
}

function updateToolbarState() {
  if (!clearReservationsButton) {
    return;
  }
  const total = getTotalReservations();
  clearReservationsButton.disabled = total === 0;
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
        const diffMinutes = Math.round((new Date(upcoming.start_time).getTime() - Date.now()) / 60000);
        const diff = timeDiffText(upcoming.start_time);
        const partySize = Number(upcoming.party_size) || table.seats;
        const infoParts = [formatDateTime(upcoming.start_time), upcoming.guest_name];
        if (partySize) {
          infoParts.push(`${partySize}人`);
        }
        if (diff) {
          infoParts.push(diff);
        }
        next.textContent = infoParts.join(' · ');
        seats.textContent = `预定人数：${partySize}人`;
        seats.classList.add('has-reservation');
        if (diffMinutes < 0) {
          card.classList.add('overdue');
        }
      } else {
        next.textContent = '暂无预定';
      }

      const phoneTail = document.createElement('div');
      phoneTail.className = 'phone-tail hidden';
      if (upcoming && upcoming.phone) {
        const tail = upcoming.phone.slice(-4);
        if (tail) {
          phoneTail.textContent = `尾号 ${tail}`;
          phoneTail.classList.remove('hidden');
        }
      }

      card.appendChild(name);
      card.appendChild(seats);
      card.appendChild(next);
      if (!phoneTail.classList.contains('hidden')) {
        card.appendChild(phoneTail);
      }

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
  const diffMinutes = Math.round((next.start.getTime() - now.getTime()) / 60000);

  if (diffMinutes < 0) {
    return { background: '#f3e5f5', border: '#8e24aa' };
  }
  if (diffMinutes <= 10) {
    return { background: '#ffebee', border: '#d32f2f' };
  }
  if (diffMinutes <= 30) {
    return { background: '#ffe5e5', border: '#ef5350' };
  }
  if (diffMinutes <= 180) {
    return { background: '#fff8e1', border: '#f9a825' };
  }
  if (diffMinutes <= 1440) {
    return { background: '#e8f5e9', border: '#4caf50' };
  }
  return null;
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
  return '已超时';
}

function openModal(tableId) {
  const table = appState.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  currentTableId = tableId;
  setCreateDefaults(table);
  populateModal(table);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
}

function closeModal() {
  currentTableId = null;
  overlay.classList.add('hidden');
  modal.classList.add('hidden');
  if (reservationForm) {
    reservationForm.reset();
    reservationForm.dataset.mode = 'create';
    if (reservationIdInput) {
      reservationIdInput.value = '';
    }
    if (formStatus) {
      formStatus.classList.add('hidden');
    }
    if (cancelEditButton) {
      cancelEditButton.classList.add('hidden');
    }
    formPristine = true;
  }
}

function populateModal(table) {
  modalTitle.textContent = `${table.name}`;
  tableMeta.innerHTML = `
    <div>楼层：${table.floor}</div>
    <div>座位数：${table.seats}</div>
    <div>当前预定：${(table.reservations || []).filter((res) => res.status === 'active').length} 条</div>
  `;

  if (reservationForm) {
    reservationForm.elements.table_id.value = table.id;
    if (reservationForm.dataset.mode !== 'edit' && formPristine) {
      if (reservationForm.elements.party_size) {
        reservationForm.elements.party_size.value = table.seats;
      }
      if (startTimeInput && !startTimeInput.value) {
        setDefaultReservationTime(startTimeInput);
      }
    }
  }

  renderReservationList(table);
}

function setDefaultReservationTime(input) {
  const now = new Date();
  const remainder = now.getMinutes() % 15;
  const increment = remainder === 0 ? 15 : 15 - remainder;
  now.setMinutes(now.getMinutes() + increment);
  now.setSeconds(0, 0);
  const tzOffset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - tzOffset * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  input.value = alignToQuarter(local);
}

function alignToQuarter(value) {
  if (!value) {
    return value;
  }
  const [datePart, timePart] = value.split('T');
  if (!timePart) {
    return value;
  }
  const timeSegments = timePart.split(':');
  if (timeSegments.length < 2) {
    return value.slice(0, 16);
  }
  const [hourStr, minuteStr] = timeSegments;
  const minuteNum = Number(minuteStr);
  if (Number.isNaN(minuteNum)) {
    return value.slice(0, 16);
  }
  const normalized = Math.floor(minuteNum / 15) * 15;
  const minuteText = String(normalized).padStart(2, '0');
  return `${datePart}T${hourStr}:${minuteText}`;
}

function setCreateDefaults(table) {
  if (!reservationForm) {
    return;
  }
  reservationForm.reset();
  reservationForm.dataset.mode = 'create';
  if (reservationIdInput) {
    reservationIdInput.value = '';
  }
  if (formStatus) {
    formStatus.classList.add('hidden');
  }
  if (cancelEditButton) {
    cancelEditButton.classList.add('hidden');
  }
  if (table) {
    reservationForm.elements.table_id.value = table.id;
    if (reservationForm.elements.party_size) {
      reservationForm.elements.party_size.value = table.seats;
    }
  }
  if (startTimeInput) {
    setDefaultReservationTime(startTimeInput);
  }
  formPristine = true;
}

function startEditReservation(reservation, table) {
  if (!reservationForm) {
    return;
  }
  reservationForm.dataset.mode = 'edit';
  formPristine = false;
  if (formStatus) {
    formStatus.classList.remove('hidden');
    formStatus.textContent = `正在编辑：${reservation.guest_name}`;
  }
  if (cancelEditButton) {
    cancelEditButton.classList.remove('hidden');
  }
  if (reservationIdInput) {
    reservationIdInput.value = reservation.id;
  }
  reservationForm.elements.table_id.value = table.id;
  reservationForm.elements.guest_name.value = reservation.guest_name || '';
  reservationForm.elements.phone.value = reservation.phone || '';
  reservationForm.elements.party_size.value = reservation.party_size || table.seats;
  reservationForm.elements.notes.value = reservation.notes || '';
  if (startTimeInput) {
    startTimeInput.value = alignToQuarter((reservation.start_time || '').slice(0, 16));
  }
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
    const itemEl = node.querySelector('.reservation-item');
    const timeEl = node.querySelector('.reservation-time');
    const guestEl = node.querySelector('.reservation-guest');
    const metaEl = node.querySelector('.reservation-meta');
    const actionsEl = node.querySelector('.reservation-actions');

    if (reservation.status === 'arrived') {
      return;
    }

    timeEl.textContent = formatDateTime(reservation.start_time);
    guestEl.textContent = `${reservation.guest_name}（${reservation.phone}）`;
    const noteText = reservation.notes ? `备注：${reservation.notes}` : '无备注';
    metaEl.textContent = `人数：${reservation.party_size} · ${noteText}`;

    actionsEl.innerHTML = '';
    if (reservation.status === 'active') {
      const now = new Date();
      const start = new Date(reservation.start_time);
      if (start.getTime() <= now.getTime()) {
        itemEl.classList.add('overdue');
        timeEl.textContent += '（已超时）';
      }

      const editBtn = document.createElement('button');
      editBtn.textContent = '编辑';
      editBtn.type = 'button';
      editBtn.classList.add('secondary');
      editBtn.addEventListener('click', () => startEditReservation(reservation, table));
      actionsEl.appendChild(editBtn);

      const arriveBtn = document.createElement('button');
      arriveBtn.textContent = '已到达';
      arriveBtn.addEventListener('click', () => handleArrived(reservation.id));
      actionsEl.appendChild(arriveBtn);

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

if (reservationForm) {
  reservationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(reservationForm);
    const payload = Object.fromEntries(formData.entries());
    const reservationId = payload.reservation_id;
    delete payload.reservation_id;

    if (!payload.start_time) {
      alert('请选择预定时间');
      return;
    }

    payload.start_time = alignToQuarter(String(payload.start_time));
    payload.party_size = Number(payload.party_size);
    if (!Number.isFinite(payload.party_size) || payload.party_size <= 0) {
      alert('请输入有效的预定人数');
      return;
    }

    payload.guest_name = (payload.guest_name || '').trim();
    payload.phone = (payload.phone || '').trim();
    payload.notes = payload.notes ? payload.notes.trim() : '';

    const url = reservationId ? `/api/reservations/${reservationId}` : '/api/reservations';
    const method = reservationId ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '保存失败');
      }

      reservationForm.dataset.mode = 'create';
      formPristine = true;
      if (reservationIdInput) {
        reservationIdInput.value = '';
      }
      if (formStatus) {
        formStatus.classList.add('hidden');
      }
      if (cancelEditButton) {
        cancelEditButton.classList.add('hidden');
      }

      await fetchTables(false);

      const table = appState.tables.find((item) => item.id === currentTableId);
      if (table) {
        setCreateDefaults(table);
        populateModal(table);
      }
    } catch (error) {
      alert(error.message);
    }
  });
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  autoRefreshTimer = setInterval(() => fetchTables(false), 60000);
}

fetchTables();
startAutoRefresh();
