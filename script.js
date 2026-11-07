const DEFAULT_TASKS = [
  { id: 'homework', title: 'Сделать домашнее задание', points: 1 },
  { id: 'training', title: 'Сходить на тренировку', points: 1 },
  { id: 'grade', title: 'Получить пятерку', points: 1 },
  { id: 'book', title: 'Прочитать 10 страниц книги', points: 1 },
  { id: 'room', title: 'Убрать в комнате', points: 1 }
];
const STORAGE_KEY = 'schoolMotivatorState';
const dateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const monthKey = (date = new Date()) => dateKey(date).slice(0, 7);
const clone = value => JSON.parse(JSON.stringify(value));

class StorageService {
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') throw new Error('Invalid state');
      return saved;
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }
  save(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
}

class AppState {
  constructor(storage) {
    this.storage = storage;
    const saved = storage.load();
    this.data = this.normalize(saved || {});
    this.role = sessionStorage.getItem('motivatorRole') || null;
    this.period = 'week';
    this.calendarDate = new Date();
    this.selectedDate = dateKey();
  }
  normalize(saved) {
    const tasks = Array.isArray(saved.tasks) && saved.tasks.length ? saved.tasks : clone(DEFAULT_TASKS);
    const normalizedTasks = tasks.filter(task => task && task.id && task.title).map(task => ({ id: String(task.id), title: String(task.title), points: this.nonNegativeInteger(task.points, 1) }));
    const checks = saved.checks && typeof saved.checks === 'object' ? Object.fromEntries(Object.entries(saved.checks).map(([key, taskIds]) => [key, Array.isArray(taskIds) ? taskIds.map(String) : []])) : {};
    const dailyResults = {};
    if (saved.dailyResults && typeof saved.dailyResults === 'object') {
      Object.entries(saved.dailyResults).forEach(([key, result]) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) return;
        dailyResults[key] = Object.fromEntries(Object.entries(result).filter(([, task]) => task && typeof task.title === 'string').map(([id, task]) => [String(id), { title: task.title, points: this.nonNegativeInteger(task.points, 0) }]));
      });
    }
    const tasksById = new Map(normalizedTasks.map(task => [task.id, task]));
    Object.entries(checks).forEach(([key, taskIds]) => {
      if (dailyResults[key]) return;
      dailyResults[key] = Object.fromEntries(taskIds.filter(id => tasksById.has(id)).map(id => {
        const task = tasksById.get(id);
        return [id, { title: task.title, points: task.points }];
      }));
    });
    return {
      tasks: normalizedTasks,
      rate: this.positiveNumber(saved.rate, 10),
      limit: this.positiveNumber(saved.limit, 1000),
      pin: typeof saved.pin === 'string' && /^\d{4,8}$/.test(saved.pin) ? saved.pin : '1234',
      history: saved.history && typeof saved.history === 'object' ? saved.history : {},
      checks,
      dailyResults
    };
  }
  positiveNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback; }
  nonNegativeInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : fallback; }
  persist() { this.storage.save(this.data); }
  setRole(role) { this.role = role; sessionStorage.setItem('motivatorRole', role); }
  getChecks(key = dateKey()) { return Array.isArray(this.data.checks[key]) ? this.data.checks[key] : []; }
  isChecked(taskId, key = dateKey()) { return this.getChecks(key).includes(taskId); }
  toggleTask(taskId) {
    const key = dateKey();
    const checked = new Set(this.getChecks(key));
    const task = this.data.tasks.find(item => item.id === taskId);
    if (!task) return;
    if (!this.data.dailyResults[key]) this.data.dailyResults[key] = {};
    if (checked.has(taskId)) {
      checked.delete(taskId);
      delete this.data.dailyResults[key][taskId];
    } else {
      checked.add(taskId);
      this.data.dailyResults[key][taskId] = { title: task.title, points: task.points };
    }
    this.data.checks[key] = [...checked];
    this.persist();
  }
  tasksForDay(key = dateKey()) {
    const result = this.data.dailyResults[key];
    if (result) return Object.entries(result).map(([id, task]) => ({ id, title: task.title, points: task.points }));
    const tasksById = new Map(this.data.tasks.map(task => [task.id, task]));
    return this.getChecks(key).filter(id => tasksById.has(id)).map(id => tasksById.get(id));
  }
  completedTasksForDay(key) { return this.tasksForDay(key).length; }
  pointsForDay(key) {
    return this.tasksForDay(key).reduce((total, task) => total + task.points, 0);
  }
  monthPoints(date = new Date()) {
    const prefix = monthKey(date);
    const keys = new Set([...Object.keys(this.data.checks), ...Object.keys(this.data.dailyResults)]);
    return [...keys].reduce((total, key) => key.startsWith(prefix) ? total + this.pointsForDay(key) : total, 0);
  }
  rublesForPoints(points) { return points * this.data.rate; }
  effectiveMonthPoints(date = new Date()) { return Math.min(this.monthPoints(date), this.data.limit / (this.data.rate || 1)); }
  setRules(rate, limit) { this.data.rate = this.positiveNumber(rate, 0); this.data.limit = this.positiveNumber(limit, 0); this.persist(); }
  addTask(title, points) { this.data.tasks.push({ id: `task-${Date.now()}`, title: title.trim(), points: this.nonNegativeInteger(points, 1) }); this.persist(); }
  setTaskPoints(id, points) { const task = this.data.tasks.find(item => item.id === id); if (!task) return; task.points = this.nonNegativeInteger(points, task.points); this.persist(); }
  removeTask(id) { this.data.tasks = this.data.tasks.filter(task => task.id !== id); this.persist(); }
  getPeriodKeys() {
    const days = this.period === 'week' ? 7 : new Date().getDate();
    return Array.from({ length: days }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (days - index - 1)); return dateKey(date); });
  }
  currentStreak() {
    let streak = 0;
    const cursor = new Date();
    while (this.completedTasksForDay(dateKey(cursor)) > 0) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }
}

class Renderer {
  constructor(state) { this.state = state; this.charts = {}; }
  money(value) { return `${Math.round(value).toLocaleString('ru-RU')} ₽`; }
  renderAll() { this.renderRole(); this.renderHeader(); this.renderToday(); this.renderTasks(); this.renderSettings(); this.renderAnalytics(); }
  renderRole() {
    const isParent = this.state.role === 'parent';
    document.querySelector('#rolePill').textContent = isParent ? 'Родитель' : 'Школьник';
    document.querySelectorAll('.parent-only').forEach(element => { element.classList.toggle('hidden', !isParent); });
    if (!isParent && document.querySelector('#settingsView').classList.contains('active-view')) this.showView('todayView');
  }
  renderHeader() {
    const today = new Date();
    document.querySelector('#dateLabel').textContent = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    document.querySelector('#greeting').textContent = this.state.role === 'student' ? 'Твой день, твои победы' : 'День маленьких побед';
    const streak = this.state.currentStreak();
    document.querySelector('#streakValue').textContent = `${streak} ${this.plural(streak, 'день', 'дня', 'дней')}`;
  }
  plural(number, one, few, many) { const mod10 = number % 10; const mod100 = number % 100; return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? few : many; }
  renderToday() {
    const todayPoints = this.state.pointsForDay();
    const monthPoints = this.state.monthPoints();
    const monthRubles = this.state.rublesForPoints(this.state.effectiveMonthPoints());
    const percent = this.state.data.limit ? Math.min(100, Math.round(monthRubles / this.state.data.limit * 100)) : 0;
    document.querySelector('#todayPoints').textContent = todayPoints;
    document.querySelector('#todayRubles').textContent = this.money(this.state.rublesForPoints(todayPoints));
    document.querySelector('#monthPoints').textContent = `${monthPoints} ${this.plural(monthPoints, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#monthRubles').textContent = Math.round(monthRubles).toLocaleString('ru-RU');
    document.querySelector('#limitProgress').style.width = `${percent}%`;
    document.querySelector('#limitProgressText').textContent = `${percent}% лимита`;
    document.querySelector('#limitCaption').textContent = `Лимит: ${this.money(this.state.data.limit)}`;
    document.querySelector('#todayMessage').textContent = this.state.data.limit > 0 && monthRubles >= this.state.data.limit ? 'Месячный лимит достигнут. Отличный результат!' : todayPoints ? 'Так держать! Еще одна маленькая победа.' : 'Выбери первое выполненное задание.';
  }
  renderTasks() {
    const list = document.querySelector('#taskList');
    list.innerHTML = this.state.data.tasks.map(task => {
      const checked = this.state.isChecked(task.id);
      const savedTask = this.state.data.dailyResults[dateKey()] && this.state.data.dailyResults[dateKey()][task.id];
      const points = checked && savedTask ? savedTask.points : task.points;
      return `<label class="task-item ${checked ? 'done' : ''}"><input class="task-check" type="checkbox" data-task-id="${this.escape(task.id)}" ${checked ? 'checked' : ''}><span class="task-title">${this.escape(task.title)}</span><span class="task-points">+${points} ${this.plural(points, 'балл', 'балла', 'баллов')}</span></label>`;
    }).join('');
    document.querySelector('#emptyTasks').classList.toggle('hidden', this.state.data.tasks.length > 0);
    const completedToday = this.state.data.tasks.filter(task => this.state.isChecked(task.id)).length;
    document.querySelector('#completionCount').textContent = `${completedToday} из ${this.state.data.tasks.length}`;
  }
  renderSettings() {
    document.querySelector('#rateInput').value = this.state.data.rate;
    document.querySelector('#limitInput').value = this.state.data.limit;
    document.querySelector('#manageTasks').innerHTML = this.state.data.tasks.map(task => `<div class="manage-row"><span class="manage-title">${this.escape(task.title)}</span><label class="points-field"><input class="text-input task-points-input" type="number" min="0" step="1" value="${task.points}" data-points-id="${this.escape(task.id)}" aria-label="Баллы за задание «${this.escape(task.title)}»"><span>баллов</span></label><button class="delete-task" type="button" data-delete-id="${this.escape(task.id)}" aria-label="Удалить задание">×</button></div>`).join('');
  }
  renderAnalytics() { this.renderCalendar(); this.renderCharts(); this.renderReport(); this.renderSelectedDay(); }
  renderCalendar() {
    const date = this.state.calendarDate; const year = date.getFullYear(); const month = date.getMonth();
    document.querySelector('#calendarTitle').textContent = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7; const days = new Date(year, month + 1, 0).getDate();
    const grid = document.querySelector('#calendarGrid'); grid.innerHTML = '';
    const today = dateKey();
    for (let i = 0; i < firstDay; i++) grid.insertAdjacentHTML('beforeend', '<span class="day-cell empty"></span>');
    for (let day = 1; day <= days; day++) {
      const key = dateKey(new Date(year, month, day));
      const points = this.state.pointsForDay(key);
      const count = Math.min(3, points);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `day-cell has-${count}${key === today ? ' today' : ''}${key === this.state.selectedDate ? ' selected' : ''}`;
      button.dataset.date = key;
      button.disabled = key > today;
      button.title = `${points} ${this.plural(points, 'балл', 'балла', 'баллов')}`;
      button.setAttribute('aria-label', `${new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}: ${button.title}`);
      button.setAttribute('aria-pressed', String(key === this.state.selectedDate));
      button.textContent = day;
      grid.append(button);
    }
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    document.querySelector('#nextMonthButton').disabled = date >= currentMonth;
  }
  renderCharts() {
    const keys = this.state.getPeriodKeys(); const values = keys.map(key => this.state.pointsForDay(key)); const completed = keys.reduce((sum, key) => sum + this.state.completedTasksForDay(key), 0); const total = values.reduce((sum, value) => sum + value, 0); const possible = Math.max(keys.length * this.state.data.tasks.length, completed); const completedPercent = possible ? Math.round(completed / possible * 100) : 0;
    document.querySelector('#completionPercent').textContent = `${completedPercent}%`; document.querySelector('#chartTotal').textContent = `${total} ${this.plural(total, 'балл', 'балла', 'баллов')}`; document.querySelector('#chartPeriodLabel').textContent = this.state.period === 'week' ? 'Последние 7 дней' : 'С начала месяца';
    const labels = keys.map(key => new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
    if (typeof Chart === 'undefined') return;
    if (this.charts.donut) this.charts.donut.destroy(); if (this.charts.line) this.charts.line.destroy();
    this.charts.donut = new Chart(document.querySelector('#completionChart'), { type: 'doughnut', data: { labels: ['Выполнено', 'Осталось'], datasets: [{ data: [completed, Math.max(0, possible - completed)], backgroundColor: ['#388e78', '#e6eeea'], borderWidth: 0 }] }, options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${context.raw} заданий` } } }, maintainAspectRatio: false } });
    this.charts.line = new Chart(document.querySelector('#pointsChart'), { type: 'line', data: { labels, datasets: [{ data: values, borderColor: '#388e78', backgroundColor: 'rgba(153,214,191,.22)', fill: true, tension: .38, pointRadius: 3, pointBackgroundColor: '#388e78' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, color: '#718086' }, grid: { color: '#edf2ef' } }, x: { ticks: { color: '#718086', maxRotation: 0 }, grid: { display: false } } } } });
  }
  renderReport() {
    const keys = this.state.getPeriodKeys();
    const values = keys.map(key => this.state.pointsForDay(key));
    const total = values.reduce((sum, value) => sum + value, 0);
    const completed = keys.reduce((sum, key) => sum + this.state.completedTasksForDay(key), 0);
    const activeDays = keys.filter(key => this.state.completedTasksForDay(key) > 0).length;
    const bestValue = Math.max(0, ...values);
    const bestIndex = values.indexOf(bestValue);
    const periodLabel = this.state.period === 'week' ? 'неделю' : 'месяц';
    document.querySelector('#reportTitle').textContent = `Отчёт за ${periodLabel}`;
    document.querySelector('#reportBadge').textContent = `${total} ${this.plural(total, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#reportPoints').textContent = total;
    document.querySelector('#reportTasks').textContent = completed;
    document.querySelector('#reportActiveDays').textContent = activeDays;
    document.querySelector('#reportPointsLabel').textContent = `${this.plural(total, 'балл', 'балла', 'баллов')} набрано`;
    document.querySelector('#reportTasksLabel').textContent = `${this.plural(completed, 'задание', 'задания', 'заданий')} выполнено`;
    document.querySelector('#reportActiveDaysLabel').textContent = `${this.plural(activeDays, 'день', 'дня', 'дней')} с результатом`;
    document.querySelector('#reportBestDay').textContent = bestValue
      ? `Лучший день: ${new Date(`${keys[bestIndex]}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · ${bestValue} ${this.plural(bestValue, 'балл', 'балла', 'баллов')}`
      : 'Пока нет выполненных заданий';
    const maxValue = Math.max(1, ...values);
    document.querySelector('#reportBars').innerHTML = keys.map((key, index) => {
      const value = values[index];
      const height = value ? Math.max(8, Math.round(value / maxValue * 100)) : 3;
      const date = new Date(`${key}T12:00:00`);
      const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return `<div class="report-bar-column" title="${this.escape(label)}: ${value} ${this.plural(value, 'балл', 'балла', 'баллов')}"><div class="report-bar-track"><span class="${value === bestValue && value > 0 ? 'best' : ''}" style="height:${height}%"></span></div><small>${date.getDate()}</small></div>`;
    }).join('');
  }
  renderSelectedDay() {
    const key = this.state.selectedDate;
    const date = new Date(`${key}T12:00:00`);
    const tasks = this.state.tasksForDay(key);
    const points = this.state.pointsForDay(key);
    document.querySelector('#selectedDayTitle').textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelector('#selectedDayPoints').textContent = `${points} ${this.plural(points, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#selectedDayRubles').textContent = this.money(this.state.rublesForPoints(points));
    document.querySelector('#selectedDayTaskCount').textContent = `${tasks.length} ${this.plural(tasks.length, 'задание выполнено', 'задания выполнено', 'заданий выполнено')}`;
    document.querySelector('#selectedDayTasks').innerHTML = tasks.map(task => `<li><span>${this.escape(task.title)}</span><strong>+${task.points}</strong></li>`).join('');
    document.querySelector('#selectedDayEmpty').classList.toggle('hidden', tasks.length > 0);
  }
  showView(viewId) { document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === viewId)); document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === viewId)); }
  escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
}

class AppController {
  constructor() { this.state = new AppState(new StorageService()); this.renderer = new Renderer(this.state); this.bindEvents(); this.start(); }
  start() { this.renderer.renderAll(); if (!this.state.role) this.openRoleModal(); }
  bindEvents() {
    document.querySelector('#taskList').addEventListener('change', event => { if (!event.target.matches('.task-check')) return; const before = this.state.monthPoints(); this.state.toggleTask(event.target.dataset.taskId); const after = this.state.monthPoints(); if (this.state.data.limit && this.state.rublesForPoints(after) > this.state.data.limit && after > before) this.toast('Месячный лимит уже достигнут: новый балл не начислен.'); this.renderer.renderAll(); });
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { if (tab.classList.contains('hidden')) return; this.renderer.showView(tab.dataset.view); if (tab.dataset.view === 'analyticsView') this.renderer.renderAnalytics(); }));
    document.querySelectorAll('.period-button').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.period-button').forEach(item => item.classList.remove('active')); button.classList.add('active'); this.state.period = button.dataset.period; this.renderer.renderAnalytics(); }));
    document.querySelector('#calendarGrid').addEventListener('click', event => { const day = event.target.closest('[data-date]'); if (!day || day.disabled) return; this.state.selectedDate = day.dataset.date; this.renderer.renderAnalytics(); });
    document.querySelector('#previousMonthButton').addEventListener('click', () => { this.state.calendarDate = new Date(this.state.calendarDate.getFullYear(), this.state.calendarDate.getMonth() - 1, 1); this.renderer.renderCalendar(); });
    document.querySelector('#nextMonthButton').addEventListener('click', () => { if (document.querySelector('#nextMonthButton').disabled) return; this.state.calendarDate = new Date(this.state.calendarDate.getFullYear(), this.state.calendarDate.getMonth() + 1, 1); this.renderer.renderCalendar(); });
    document.querySelector('#saveRulesButton').addEventListener('click', () => { const rate = Number(document.querySelector('#rateInput').value); const limit = Number(document.querySelector('#limitInput').value); if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(limit) || limit < 0) return this.feedback('#rulesFeedback', 'Введите корректные неотрицательные значения.', true); this.state.setRules(rate, limit); this.renderer.renderAll(); this.feedback('#rulesFeedback', 'Правила сохранены.'); });
    document.querySelector('#addTaskForm').addEventListener('submit', event => { event.preventDefault(); const input = document.querySelector('#newTaskInput'); const pointsInput = document.querySelector('#newTaskPointsInput'); const title = input.value.trim(); const points = Number(pointsInput.value); if (!title) return; if (!Number.isInteger(points) || points < 0) return this.toast('Укажите целое неотрицательное число баллов.'); this.state.addTask(title, points); input.value = ''; pointsInput.value = '1'; this.renderer.renderAll(); this.toast('Задание добавлено.'); });
    document.querySelector('#manageTasks').addEventListener('change', event => { const input = event.target.closest('[data-points-id]'); if (!input) return; const points = Number(input.value); if (!Number.isInteger(points) || points < 0) { this.renderer.renderSettings(); return this.toast('Укажите целое неотрицательное число баллов.'); } this.state.setTaskPoints(input.dataset.pointsId, points); this.renderer.renderAll(); this.toast('Баллы за задание обновлены.'); });
    document.querySelector('#manageTasks').addEventListener('click', event => { const button = event.target.closest('[data-delete-id]'); if (!button) return; this.state.removeTask(button.dataset.deleteId); this.renderer.renderAll(); this.toast('Задание удалено.'); });
    document.querySelector('#savePinButton').addEventListener('click', () => { const input = document.querySelector('#pinInput'); if (!/^\d{4,8}$/.test(input.value)) return this.feedback('#pinFeedback', 'PIN должен содержать от 4 до 8 цифр.', true); this.state.data.pin = input.value; this.state.persist(); input.value = ''; this.feedback('#pinFeedback', 'PIN обновлен.'); });
    document.querySelector('#switchRoleButton').addEventListener('click', () => this.openRoleModal());
    document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => { if (button.dataset.role === 'parent') { document.querySelector('.role-options').classList.add('hidden'); document.querySelector('#pinForm').classList.remove('hidden'); document.querySelector('#modalPinInput').focus(); } else { this.setRoleAndClose('student'); } }));
    document.querySelector('#pinForm').addEventListener('submit', event => { event.preventDefault(); const input = document.querySelector('#modalPinInput'); if (input.value === this.state.data.pin) this.setRoleAndClose('parent'); else this.feedback('#pinError', 'PIN не подошел. Попробуйте еще раз.', true); });
  }
  openRoleModal() { document.querySelector('#roleModal').classList.remove('hidden'); document.querySelector('.role-options').classList.remove('hidden'); document.querySelector('#pinForm').classList.add('hidden'); document.querySelector('#modalPinInput').value = ''; }
  setRoleAndClose(role) { this.state.setRole(role); document.querySelector('#roleModal').classList.add('hidden'); this.renderer.renderAll(); }
  feedback(selector, text, error = false) { const element = document.querySelector(selector); element.textContent = text; element.classList.toggle('error', error); setTimeout(() => { element.textContent = ''; }, 3000); }
  toast(text) { const element = document.querySelector('#toast'); element.textContent = text; element.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => element.classList.remove('show'), 2800); }
}

document.addEventListener('DOMContentLoaded', () => new AppController());
