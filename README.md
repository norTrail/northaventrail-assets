•	/css/ and /js/ — manually maintained, edited on computers, pushed via GitHub Desktop
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

