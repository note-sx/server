function initDocument() {
  /*
   * Callout fold/unfold
   */
  document.querySelectorAll('.callout.is-collapsible > .callout-title')
    .forEach(titleEl => {
      // Add a listener on the title element
      titleEl.addEventListener('click', () => {
        const calloutEl = titleEl.parentElement;
        // Toggle the collapsed class
        calloutEl.classList.toggle('is-collapsed');
        titleEl.querySelector('.callout-fold').classList.toggle('is-collapsed');
        // Show/hide the content
        calloutEl.querySelector('.callout-content').style.display = calloutEl.classList.contains('is-collapsed') ? 'none' : '';
      });
    });

  /*
   * List fold/unfold
   */
  document.querySelectorAll('.list-collapse-indicator')
    .forEach(collapseEl => {
      collapseEl.addEventListener('click', () => {
        // Toggle the collapsed class
        collapseEl.classList.toggle('is-collapsed');
        collapseEl.parentElement.classList.toggle('is-collapsed');
      });
    });

  /*
   * Light/Dark theme toggle
   */
  const themeToggleEl = document.querySelector('#theme-mode-toggle');
  themeToggleEl.onclick = () => {
    document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light');
  };

  /*
   * Copy code button
   */
  document.querySelectorAll('button.copy-code-button')
    .forEach(buttonEl => {
      buttonEl.addEventListener('click', () => {
        const codeEl = buttonEl.parentElement.querySelector('code');
        navigator.clipboard.writeText(codeEl.innerText.trim()).then();
      });
    });

  /*
   * Responsive mobile classes
   */
  function toggleMobileClasses() {
    const mobileClasses = ['is-mobile', 'is-phone'];
    if (window.innerWidth <= 768) {
      // Is mobile
      document.body.classList.add(...mobileClasses);
    } else {
      document.body.classList.remove(...mobileClasses);
    }
  }

  toggleMobileClasses();
  window.addEventListener('resize', toggleMobileClasses);

  // Track which files are visited so we can determine which notes/files are no longer in use.
  // You can check the code, this sends only the string names of the files as an array.
  try {
    let css = Array.from(document.styleSheets).map(x => Array.from(x.cssRules).map(x => x.cssText).join()).join()
    css += document.documentElement.outerHTML

    const regex = new RegExp(`${window.location.origin}\\/(files|css)\\/[^"]+`, 'g')
    const files = css
      .match(regex)
      ?.map(url => url?.match(/([^/]+)$/)?.[1])

    fetch(window.location.origin + '/v1/view', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        note: window.location.pathname.match(/^\/(\w+)/)?.[1],
        files: files || []
      })
    }).then().catch();
  } catch (e) {
    console.log(e)
  }

  /*
   * Lucide icons
   */
  addScript(window.location.origin + '/assets/lucide.0.287.0.js', () => {
    lucide.createIcons({
      attrs: {
        class: ['callout-icon']
      },
      nameAttr: 'data-share-note-lucide'
    });
  });
}

function addScript(url, onload) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;
  if (onload) script.onload = onload;
  document.head.appendChild(script);
}
