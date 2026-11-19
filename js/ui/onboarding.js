const MVP_STORAGE_KEY = 'hsd_mvp_notice_dismissed_v1';

export function startGuidedTour() {
  if (typeof window.introJs !== 'function') {
    alert('Intro.js tour library failed to load.');
    return;
  }

  const steps = [
    {
      title: 'Welcome to Heritage Statement Drafter',
      intro:
        'Draft structured NPPF & Historic England GPA3 Desk-Based Heritage Statements grounded directly in live NHLE, Heritage at Risk, and ADS data.',
    },
    {
      element: '#engine-controls',
      title: '1. Choose Your AI Engine',
      intro:
        'Run privately on-device with Local Ollama, bring your own Anthropic Claude or OpenAI key (stored only in tab sessionStorage), or copy the grounded prompt for any LLM.',
      position: 'bottom',
    },
    {
      element: '#geojson-dropzone',
      title: '2. Import Screener GeoJSON or Search',
      intro:
        'Drop a .geojson exported from Heritage Constraints Screener, or search any UK postcode, town, or sample heritage site below.',
      position: 'right',
    },
    {
      element: '#mini-map',
      title: '3. Interactive Constraints Map',
      intro:
        'Click any designated polygon or asset dot to inspect official NHLE/ADS records, or click empty map space to move the site pin and re-screen.',
      position: 'right',
    },
    {
      element: '#proposal-title',
      title: '4. Enter Development Parameters',
      intro:
        'Specify the project title, scheme type, massing, and visual screening or material notes to inform the GPA3 setting appraisal.',
      position: 'right',
    },
    {
      element: '#pane-synthesis',
      title: '5. Section-by-Section Drafting & Citation Auditor',
      intro:
        'Click "Draft Full Statement" to stream all 4 sections sequentially, or regenerate individual sections. The Citation Auditor verifies every NHLE List Entry number against real data.',
      position: 'left',
    },
    {
      element: '#pane-preview',
      title: '6. Live Statement & Vector PDF Export',
      intro:
        'Review the formatted Heritage Statement in real time and export to Markdown, native vector PDF, or Screener-compatible GeoJSON.',
      position: 'left',
    },
  ].filter((step) => !step.element || document.querySelector(step.element));

  window
    .introJs()
    .setOptions({
      steps,
      showProgress: true,
      showBullets: false,
      exitOnOverlayClick: true,
      nextLabel: 'Next →',
      prevLabel: '← Back',
      doneLabel: 'Finish Tour',
    })
    .start();
}

export function initMvpOverlayAndTour() {
  const modal = document.getElementById('mvp-modal');
  const openBtn = document.getElementById('mvp-info-btn');
  const closeXBtn = document.getElementById('mvp-modal-close-x');
  const acceptBtn = document.getElementById('mvp-accept-btn');
  const startTourFromModalBtn = document.getElementById('mvp-start-tour-btn');
  const checkbox = document.getElementById('mvp-dont-show-checkbox');
  const headerTourBtn = document.getElementById('tour-btn');

  if (!modal) return;

  const openModal = () => {
    if (checkbox) {
      checkbox.checked = localStorage.getItem(MVP_STORAGE_KEY) === 'true';
    }
    modal.classList.remove('hidden');
  };

  const closeModal = () => {
    if (checkbox) {
      if (checkbox.checked) {
        localStorage.setItem(MVP_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(MVP_STORAGE_KEY);
      }
    }
    modal.classList.add('hidden');
  };

  // Show automatically on first visit unless user checked "Don't show again"
  if (localStorage.getItem(MVP_STORAGE_KEY) !== 'true') {
    openModal();
  }

  openBtn?.addEventListener('click', openModal);
  closeXBtn?.addEventListener('click', closeModal);
  acceptBtn?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  startTourFromModalBtn?.addEventListener('click', () => {
    closeModal();
    startGuidedTour();
  });

  headerTourBtn?.addEventListener('click', startGuidedTour);
}