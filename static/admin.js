const refreshButton = document.getElementById('refreshButton');
const goFrontButton = document.getElementById('goFront');
const addTableForm = document.getElementById('addTableForm');
const tableList = document.getElementById('tableList');
const statusText = document.getElementById('statusText');

const adminState = {
  tables: [],
};

function setStatus(message = '', type = 'info') {
  if (!statusText) {
    return;
  }
  statusText.textContent = message;
  statusText.style.color = type === 'error' ? 'var(--danger)' : 'rgba(0, 0, 0, 0.6)';
}

async function fetchTables(showMessage = true) {
  try {
    const response = await fetch('/api/tables');
    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    const data = await response.json();
    adminState.tables = data.tables || [];
    renderTableList();
    if (showMessage) {
      setStatus('已同步最新桌位数据。');
    }
  } catch (error) {
    console.error(error);
    setStatus('加载桌位数据失败，请稍后重试。', 'error');
    if (showMessage) {
      alert('加载桌位数据失败，请稍后重试。');
    }
  }
}

function renderTableList() {
  tableList.innerHTML = '';
  if (!adminState.tables.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '暂无桌位，请先添加新的桌位。';
    tableList.appendChild(empty);
    return;
  }

  adminState.tables.forEach((table) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-manage-item';

    const info = document.createElement('div');
    info.textContent = `${table.floor} · ${table.name} · ${table.seats}座`;

    const form = document.createElement('form');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.name = 'name';
    nameInput.value = table.name;
    nameInput.required = true;

    const seatsInput = document.createElement('input');
    seatsInput.type = 'number';
    seatsInput.name = 'seats';
    seatsInput.value = table.seats;
    seatsInput.min = '1';
    seatsInput.required = true;

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = '保存';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.classList.add('danger');

    form.appendChild(nameInput);
    form.appendChild(seatsInput);
    form.appendChild(saveButton);
    form.appendChild(deleteButton);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: nameInput.value,
        seats: Number(seatsInput.value),
      };
      try {
        const response = await fetch(`/api/admin/tables/${table.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || '更新失败');
        }
        setStatus(`已更新“${payload.name}”，前台刷新即可查看最新桌位。`);
        await fetchTables(false);
      } catch (error) {
        console.error(error);
        setStatus(error.message || '更新失败', 'error');
        alert(error.message || '更新失败');
      }
    });

    deleteButton.addEventListener('click', async () => {
      if (!confirm('确定删除该桌位及其相关预定吗？')) {
        return;
      }
      try {
        const response = await fetch(`/api/admin/tables/${table.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || '删除失败');
        }
        setStatus(`已删除“${table.name}”，前台刷新即可查看最新桌位。`);
        await fetchTables(false);
      } catch (error) {
        console.error(error);
        setStatus(error.message || '删除失败', 'error');
        alert(error.message || '删除失败');
      }
    });

    wrapper.appendChild(info);
    wrapper.appendChild(form);
    tableList.appendChild(wrapper);
  });
}

refreshButton.addEventListener('click', () => fetchTables());

goFrontButton.addEventListener('click', () => {
  window.location.href = '/';
});

addTableForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(addTableForm);
  const payload = {
    floor: formData.get('floor'),
    name: formData.get('name'),
    seats: Number(formData.get('seats')),
  };
  try {
    const response = await fetch('/api/admin/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || '新增桌位失败');
    }
    addTableForm.reset();
    // 重置默认值
    addTableForm.elements.seats.value = 4;
    setStatus(`已新增桌位“${payload.name}”，前台刷新即可查看最新桌位。`);
    await fetchTables(false);
  } catch (error) {
    console.error(error);
    setStatus(error.message || '新增桌位失败', 'error');
    alert(error.message || '新增桌位失败');
  }
});

setStatus('请通过下方列表维护桌位。');
fetchTables(false);

