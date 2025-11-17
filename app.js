
// PWA: register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .catch(err => console.error('SW registration failed:', err));
    });
  }
  
const API_URL = 'https://script.google.com/macros/s/AKfycbxPfN3fTjuWTtjuJRa2mbZeViueEU7hvpjgf1Ka0PutlTuBQ8xNTn_zF_own882MElzGg/exec';

// In-memory contacts
let contacts = [];
let currentIndex = -1;

const filters = {
  searchText: '',
  status: '',
  followupDue: false
};

// === INITIAL LOAD ===
document.addEventListener('DOMContentLoaded', () => {
  loadContacts();
  setupEventHandlers();
});

// Try loading from Sheets via API; fall back to localStorage if offline
async function loadContacts() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'listContacts' })
    });
    

    if (!res.ok) throw new Error('Network response was not ok');
    contacts = await res.json();
    localStorage.setItem('aple_crm_contacts', JSON.stringify(contacts));
  } catch (err) {
    console.warn('Could not load from API, using localStorage:', err);
    const stored = localStorage.getItem('aple_crm_contacts');
    contacts = stored ? JSON.parse(stored) : [];
  }

  renderContactsTable();
  loadNextContact();
  updateAnalytics();
}

function setupEventHandlers() {
  document.getElementById('next-contact-btn')
    .addEventListener('click', loadNextContact);

  document.getElementById('mark-interested-btn')
    .addEventListener('click', () => updateCurrentStatus('Interested'));

  document.getElementById('mark-followup-btn')
    .addEventListener('click', () => {
      const followDate = document.getElementById('followup-date').value || null;
      updateCurrentStatus('Follow-up', followDate);
    });

  document.getElementById('mark-notinterested-btn')
    .addEventListener('click', () => updateCurrentStatus('Not Interested'));

  document.getElementById('send-email-selected-btn')
    .addEventListener('click', sendSelectedEmails);

  document.getElementById('select-all')
    .addEventListener('change', (e) => {
      const checked = e.target.checked;
      document
        .querySelectorAll('.contact-checkbox')
        .forEach(cb => cb.checked = checked);
    });

  // Filters
  document.getElementById('search-text')
    .addEventListener('input', (e) => {
      filters.searchText = e.target.value.toLowerCase();
      renderContactsTable();
      updateAnalytics();
    });

  document.getElementById('status-filter')
    .addEventListener('change', (e) => {
      filters.status = e.target.value;
      renderContactsTable();
      updateAnalytics();
    });

  document.getElementById('followup-due-filter')
    .addEventListener('change', (e) => {
      filters.followupDue = e.target.checked;
      renderContactsTable();
      updateAnalytics();
    });
}
function getFilteredContacts() {
  const todayStr = new Date().toISOString().slice(0, 10);

  return contacts.filter(c => {
    const status = (c.status || '').trim();

    if (filters.status && status !== filters.status) {
      return false;
    }

    if (filters.followupDue) {
      const nf = (c.nextFollowUp || '').toString().slice(0, 10);
      if (!nf || nf > todayStr) return false; // only today or overdue
    }

    if (filters.searchText) {
      const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ');
      const blob = [
        fullName,
        c.email || '',
        c.phone || ''
      ]
        .join(' ')
        .toLowerCase();

      if (!blob.includes(filters.searchText)) return false;
    }

    return true;
  });
}

function updateAnalytics() {
  const total = contacts.length;
  let countNew = 0;
  let countInterested = 0;
  let countFollowup = 0;
  let countNotInterested = 0;

  contacts.forEach(c => {
    const s = (c.status || 'New').toLowerCase();
    if (!c.status || s === 'new') countNew++;
    else if (s === 'interested') countInterested++;
    else if (s === 'follow-up' || s === 'followup') countFollowup++;
    else if (s === 'not interested') countNotInterested++;
  });

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-new').textContent = countNew;
  document.getElementById('stat-interested').textContent = countInterested;
  document.getElementById('stat-followup').textContent = countFollowup;
  document.getElementById('stat-notinterested').textContent = countNotInterested;

  // Upcoming follow-ups
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = contacts
    .filter(c => {
      const nf = (c.nextFollowUp || '').toString().slice(0, 10);
      return nf && nf >= today;
    })
    .sort((a, b) => {
      const da = new Date(a.nextFollowUp);
      const db = new Date(b.nextFollowUp);
      return da - db;
    })
    .slice(0, 5);

  const list = document.getElementById('upcoming-followups');
  list.innerHTML = '';

  if (!upcoming.length) {
    list.innerHTML = '<li>No upcoming follow-ups scheduled.</li>';
    return;
  }

  upcoming.forEach(c => {
    const fullName =
      [c.firstName, c.lastName].filter(Boolean).join(' ') || '(No name)';
    const li = document.createElement('li');
    li.textContent = `${c.nextFollowUp} – ${fullName} (${c.status || 'Follow-up'})`;
    list.appendChild(li);
  });
}



// === RENDER CONTACTS TABLE ===
function renderContactsTable() {
  const tbody = document.getElementById('contacts-body');
  tbody.innerHTML = '';

  const filtered = getFilteredContacts();

  filtered.forEach((c) => {
    const idx = contacts.indexOf(c); // keep original index for checkboxes
    const tr = document.createElement('tr');

    const fullName =
      [c.firstName, c.lastName].filter(Boolean).join(' ') || '(No name)';

    tr.innerHTML = `
      <td><input type="checkbox" class="contact-checkbox" data-index="${idx}" /></td>
      <td>${fullName}</td>
      <td>${c.email || ''}</td>
      <td>${c.phone || ''}</td>
      <td>${c.status || ''}</td>
      <td>${c.nextFollowUp || ''}</td>
      <td>
        ${c.phone ? `<a href="tel:${c.phone}">Call</a>` : ''}
      </td>
    `;

    tbody.appendChild(tr);
  });
}


// === COLD CALL FLOW ===
function loadNextContact() {
  if (!contacts.length) {
    document.getElementById('current-contact').innerHTML = '<p>No contacts available.</p>';
    return;
  }

  // find next "New" or "Follow-up" contact; if none, cycle
  let start = currentIndex;
  let foundIndex = -1;

  for (let i = 0; i < contacts.length; i++) {
    const idx = (currentIndex + 1 + i) % contacts.length;
    const status = (contacts[idx].status || 'New').toLowerCase();
    if (status === 'new' || status === 'follow-up' || status === '') {
      foundIndex = idx;
      break;
    }
  }

  currentIndex = foundIndex === -1 ? (currentIndex + 1) % contacts.length : foundIndex;

  const c = contacts[currentIndex];
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || '(No name)';

  document.getElementById('current-contact').innerHTML = `
    <h3>${fullName}</h3>
    <p><strong>Email:</strong> ${c.email || '—'}</p>
    <p><strong>Phone:</strong> ${c.phone || '—'}</p>
    <p><strong>Status:</strong> ${c.status || 'New'}</p>
    <p><strong>Next Follow-Up:</strong> ${c.nextFollowUp || '—'}</p>
    ${c.phone ? `<p><a href="tel:${c.phone}">📞 Tap to Call</a></p>` : ''}
  `;
}

async function updateCurrentStatus(status, followDate = null) {
  if (currentIndex < 0 || currentIndex >= contacts.length) return;

  const c = contacts[currentIndex];
  c.status = status;
  if (followDate) c.nextFollowUp = followDate;

  // update local cache
  contacts[currentIndex] = c;
  localStorage.setItem('aple_crm_contacts', JSON.stringify(contacts));
  renderContactsTable();
  loadNextContact();

  // sync to Google Sheets if possible
  try {
    await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'logCall',
        id: c.id,
        status,
        nextFollowUp: followDate
      })
    });
    
  } catch (err) {
    console.warn('Could not sync call log, will stay local only for now.', err);
  }
  renderContactsTable();
  loadNextContact();
  updateAnalytics();
}

// === BULK EMAIL ===
async function sendSelectedEmails() {
  const subject = document.getElementById('email-subject').value.trim();
  const template = document.getElementById('email-template').value;

  const selected = Array.from(document.querySelectorAll('.contact-checkbox'))
    .filter(cb => cb.checked)
    .map(cb => contacts[parseInt(cb.dataset.index, 10)])
    .filter(c => c.email);

  if (!subject || !template || !selected.length) {
    alert('Need a subject, template, and at least one contact with email.');
    return;
  }

  if (!confirm(`Send this email to ${selected.length} contacts?`)) return;

  try {
    await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'sendEmails',
        subject,
        template,
        contacts: selected.map(c => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email
        }))
      })
    });
    
    alert('Emails sent (or queued by Apps Script).');
  } catch (err) {
    console.error(err);
    alert('Could not send emails. Check your Apps Script deployment or try again.');
  }
}
