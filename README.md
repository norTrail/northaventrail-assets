•	/src/css/ and /src/js/ — human-edited source files
•	/css/ and /js/ — generated deploy artifacts built from /src and pushed via GitHub
•	/json/ — generated and published by server to repository via the GitHub Contents API
•	Naming convention: CSS/JS use versioned filenames <file-name-lower-case>.v<YYYY>-<MM>-<DD>.<extension>
•	JSON uses stable filenames <file-name-lower-case>.<extension>
•	Cache strategy
	/css/*  Cache-Control: public, max-age=31536000, immutable
	/js/*  Cache-Control: public, max-age=31536000, immutable
	/json/*   Cache-Control: public, max-age=120
	/img/*  Cache-Control: public, max-age=31536000, immutable

Why this matters:
•	CSS and JS use versioned filenames, so a 1-year cache is safe — a new filename means a new cache entry
•	JSON files use stable filenames and change frequently (trail data, tracker data), so 120 seconds keeps them reasonably fresh without hammering the origin
•	If you have a live tracker JSON that updates every few minutes, reduce its cache to 30–60 seconds

Workflow:
•	Edit only /src/js and /src/css
•	Run `npm run build:assets` to regenerate /js and /css
•	Run `npm run check:generated` to confirm generated files are current
•	`/src/*` is blocked from public access on Cloudflare Pages
•	The pre-commit hook rebuilds generated assets before commit once hooks are installed

