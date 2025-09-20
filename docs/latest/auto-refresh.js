(function() {
    let lastModified = {};
    const checkInterval = 1000;

    const filesToWatch = [
        'app.js',
        'style.css',
        'index.html'
    ];

    async function checkForChanges() {
        for (const file of filesToWatch) {
            try {
                const response = await fetch(file, { method: 'HEAD' });
                const modified = response.headers.get('last-modified');

                if (lastModified[file] && lastModified[file] !== modified) {
                    console.log(`${file} changed, refreshing...`);
                    location.reload();
                    return;
                }

                lastModified[file] = modified;
            } catch (e) {
                console.error(`Error checking ${file}:`, e);
            }
        }
    }

    setInterval(checkForChanges, checkInterval);
    console.log('Auto-refresh enabled, watching for changes...');
})();