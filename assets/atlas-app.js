(function () {
	"use strict";

	const $ = (selector, root = document) => root.querySelector(selector);
	const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
	const CONFIG = JSON.parse($("#wd-data-config").textContent);
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const REGION_LABELS = ["Karakoram", "Hindu Kush", "W. Himalaya", "C. Himalaya", "N. India"];
	const REGION_LONG = ["Karakoram", "Hindu Kush", "Western Himalaya", "Central Himalaya", "North India"];
	const REGION_COLORS = ["#8f2938", "#233f78", "#08736f", "#5c7d43", "#c3931d"];
	const REGION_KEYS = ["rk", "rh", "rw", "rc", "rn"];
	const REGION_BOXES = [[74, 78, 35, 37.5], [68, 73, 34, 37], [73, 79, 30, 34], [79, 86, 27, 30.5], [74, 85, 25, 30]];
	const SEASONS = {
		djf: [12, 1, 2],
		djfm: [12, 1, 2, 3],
		mam: [3, 4, 5],
		amj: [4, 5, 6],
		jjas: [6, 7, 8, 9],
		on: [10, 11],
		ndjfma: [11, 12, 1, 2, 3, 4],
		all: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
	};
	// Exact transformed-space centres and within-cluster envelopes from the
	// Figure 5 workflow in the 2025 WD review (winter k-means, random_state=1).
	const GENESIS_REGIONS = Object.freeze([
		{ key: "north_atlantic", label: "N. Atlantic jet", longLabel: "North Atlantic jet stream", centre: [-0.2903508685, 0.6783275530], inverse: [28.79805683, -2.02806952, -2.02806952, 76.27342139], cutoff: 16.10384800 },
		{ key: "alps_northern_europe", label: "Alps / N. Europe", longLabel: "Alps/Northern Europe", centre: [0.0943975919, 0.5967533734], inverse: [85.09571446, 11.02504760, 11.02504760, 99.96015436], cutoff: 14.46141110 },
		{ key: "mediterranean", label: "Mediterranean", longLabel: "Mediterranean", centre: [0.1413656930, 0.8259841698], inverse: [161.66886951, -1.26155580, -1.26155580, 332.51741130], cutoff: 9.60112552 },
		{ key: "zagros", label: "Zagros", longLabel: "Zagros", centre: [0.3445114241, 0.8236863907], inverse: [255.85788184, -19.34032262, -19.34032262, 221.18729981], cutoff: 14.25310148 },
		{ key: "other", label: "Other", longLabel: "Other" }
	]);
	const DEFAULT_DATE_MIN = "1950-01-01";
	const DEFAULT_DATE_MAX = "2025-12-31";
	const DEFAULT_VIEW = { ...CONFIG.bounds };
	const TABLE_PAGE_SIZE = 50;
	const MAP_TRACK_LIMIT = 20000;
	const HOUR_MS = 3600000;
	const WEATHER_FIELDS = Object.freeze({
		vorticity350: { label: "350-hPa vorticity", keyMin: "0", keyMax: "28 × 10⁻⁵ s⁻¹" },
		precipitation: { label: "trailing 24 h precipitation", keyMin: "0", keyMax: "150 mm" }
	});
	const EVOLUTION_METRICS = Object.freeze({
		vorticity: { label: "450–300 hPa vorticity", shortLabel: "ζ", yLabel: "450–300 hPa ζ (10⁻⁵ s⁻¹)", unit: " ×10⁻⁵ s⁻¹", decimals: 1, zeroBased: true, colour: "--mla-madder", fallback: "#aa3d2d" },
		rain: { label: "24 h precipitation", shortLabel: "precipitation", yLabel: "24 h precipitation (mm)", unit: " mm", decimals: 2, zeroBased: true, colour: "--mla-atlas-blue", fallback: "#3978a8" },
		latitude: { label: "latitude", shortLabel: "latitude", yLabel: "Latitude (°N)", unit: "°N", decimals: 2, zeroBased: false, colour: "--mla-peacock", fallback: "#08736f" },
		longitude: { label: "longitude", shortLabel: "longitude", yLabel: "Longitude (°E)", unit: "°E", decimals: 2, zeroBased: false, colour: "--mla-indigo", fallback: "#233f78" },
		speed: { label: "translation speed", shortLabel: "speed", yLabel: "Translation speed (m s⁻¹)", unit: " m s⁻¹", decimals: 1, zeroBased: true, colour: "--mla-turmeric", fallback: "#c3931d" },
		path: { label: "cumulative path length", shortLabel: "path", yLabel: "Cumulative path length (km)", unit: " km", decimals: 0, zeroBased: true, colour: "--mla-good", fallback: "#5c7d43" },
		displacement: { label: "displacement from genesis", shortLabel: "displacement", yLabel: "Displacement from genesis (km)", unit: " km", decimals: 0, zeroBased: true, colour: "--mla-purple", fallback: "#76558f" }
	});

	let DATA;
	let CAT;
	let OFF;
	let META;
	let PLON;
	let PLAT;
	let PVORT;
	let PRAIN;
	let filtered = [];
	let selected = -1;
	let hovered = -1;
	let focusFix = 0;
	let tablePage = 0;
	let filterTimer = 0;
	let urlTimer = 0;
	let toastTimer = 0;
	let activeTab = "explore";
	let idToIndex = new Map();
	let trackNames = [];
	let genesisRegionByTrack;
	let filteredBit;
	let segmentIndex;
	let weatherVideo = null;
	let weatherMonth = "";
	let weatherField = "";
	let weatherLoadSerial = 0;
	let weatherSyncSerial = 0;
	let weatherError = "";
	let weatherLoading = false;
	let weatherFrameCanvas = null;
	let weatherFrameContext = null;
	let weatherEncodedCanvas = null;
	let weatherEncodedContext = null;

	const state = {
		timeMode: "years",
		months: new Set(SEASONS.djfm),
		regions: new Set(),
		genesisRegions: new Set(),
		yearMin: 1950,
		yearMax: 2025,
		dateMin: DEFAULT_DATE_MIN,
		dateMax: DEFAULT_DATE_MAX,
		intensityMin: 0,
		rainMin: 0,
		lengthMin: 0,
		durationMin: 0,
		query: "",
		mapLayer: "tracks",
		mapColour: "single",
		showRegionBoxes: true,
		weatherLayer: "none"
	};

	const map = {
		base: null,
		weather: null,
		data: null,
		overlay: null,
		baseContext: null,
		weatherContext: null,
		dataContext: null,
		overlayContext: null,
		width: 1,
		height: 1,
		dpr: 1,
		view: { ...DEFAULT_VIEW },
		rendered: [],
		drag: null,
		moved: false
	};

	initialise().catch((error) => {
		console.error(error);
		const loading = $("#wdLoading");
		loading.innerHTML = `<strong>Could not load the catalogue.</strong> ${escapeHtml(error.message || String(error))}`;
		loading.setAttribute("data-tone", "flag");
	});

	async function initialise() {
		const [catalogueBuffer, fixesBuffer] = await Promise.all([
			fetchInflated(CONFIG.catalogue),
			fetchInflated(CONFIG.fixes)
		]);
		DATA = JSON.parse(new TextDecoder().decode(catalogueBuffer));
		CAT = DATA.cat;
		OFF = DATA.off;
		META = DATA.meta;

		const fixes = new Int16Array(fixesBuffer);
		if (fixes.length !== META.npts * 4) {
			throw new Error(`Fix asset contains ${fixes.length} values; expected ${META.npts * 4}.`);
		}
		PLON = fixes.subarray(0, META.npts);
		PLAT = fixes.subarray(META.npts, META.npts * 2);
		PVORT = fixes.subarray(META.npts * 2, META.npts * 3);
		PRAIN = fixes.subarray(META.npts * 3, META.npts * 4);
		for (let i = 0; i < META.ntracks; i += 1) idToIndex.set(String(CAT.id[i]), i);
		buildDerivedCatalogueFields();
		filteredBit = new Uint8Array(META.ntracks);
		segmentIndex = new UniformSegmentIndex();

		state.yearMin = Math.min(...CAT.year);
		state.yearMax = Math.max(...CAT.year);
		readUrlState();
		buildFilterControls();
		bindInterface();
		setupMap();
		$("#wdMethodTracks").textContent = META.ntracks.toLocaleString();
		$("#wdMethodFixes").textContent = META.npts.toLocaleString();
		$("#wdLoading").hidden = true;
		$("#wdFilters").hidden = false;
		applyFilters({ resetPage: false });
		if (selected >= 0) selectTrack(selected, { fit: false, updateUrl: false });
		switchTab(activeTab, { updateUrl: false });
	}

	async function fetchInflated(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} while loading ${url}`);
		const compressed = await response.arrayBuffer();
		const bytes = new Uint8Array(compressed);
		if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return compressed;
		if (!("DecompressionStream" in window)) {
			throw new Error("This browser does not support gzip decompression streams.");
		}
		const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
		return new Response(stream).arrayBuffer();
	}

	function pointSegmentDistanceSquared(px, py, x1, y1, x2, y2) {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lengthSquared = dx * dx + dy * dy;
		if (!lengthSquared) return (px - x1) ** 2 + (py - y1) ** 2;
		const fraction = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
		const x = x1 + fraction * dx;
		const y = y1 + fraction * dy;
		return (px - x) ** 2 + (py - y) ** 2;
	}

	class UniformSegmentIndex {
		constructor() {
			this.cellSize = 1;
			this.minLon = -20;
			this.maxLon = 145;
			this.minLat = -10;
			this.maxLat = 75;
			this.columns = Math.ceil((this.maxLon - this.minLon) / this.cellSize) + 1;
			this.rows = Math.ceil((this.maxLat - this.minLat) / this.cellSize) + 1;
			this.cells = Array.from({ length: this.columns * this.rows }, () => []);
			const x1 = [], y1 = [], x2 = [], y2 = [], owner = [];
			for (let track = 0; track < OFF.length; track += 1) {
				const [start, length] = OFF[track];
				for (let fix = 1; fix < length; fix += 1) {
					const first = start + fix - 1;
					const second = first + 1;
					const segment = owner.length;
					x1.push(PLON[first] / 100); y1.push(PLAT[first] / 100);
					x2.push(PLON[second] / 100); y2.push(PLAT[second] / 100);
					owner.push(track);
					const a = this.cellCoordinates(Math.min(x1[segment], x2[segment]), Math.min(y1[segment], y2[segment]));
					const b = this.cellCoordinates(Math.max(x1[segment], x2[segment]), Math.max(y1[segment], y2[segment]));
					for (let row = a.row; row <= b.row; row += 1) {
						for (let col = a.col; col <= b.col; col += 1) this.cells[row * this.columns + col].push(segment);
					}
				}
			}
			this.x1 = Float32Array.from(x1); this.y1 = Float32Array.from(y1);
			this.x2 = Float32Array.from(x2); this.y2 = Float32Array.from(y2);
			this.owner = Uint32Array.from(owner);
			this.seen = new Uint32Array(owner.length);
			this.stamp = 0;
		}

		cellCoordinates(lon, lat) {
			return {
				col: clamp(Math.floor((lon - this.minLon) / this.cellSize), 0, this.columns - 1),
				row: clamp(Math.floor((lat - this.minLat) / this.cellSize), 0, this.rows - 1)
			};
		}

		query(screenX, screenY, radiusPx, onlyTrack = -1) {
			const geographical = screenToLonLat(screenX, screenY);
			const radiusLon = radiusPx / map.width * (map.view.east - map.view.west);
			const radiusLat = radiusPx / map.height * (map.view.north - map.view.south);
			const a = this.cellCoordinates(geographical.lon - radiusLon, geographical.lat - radiusLat);
			const b = this.cellCoordinates(geographical.lon + radiusLon, geographical.lat + radiusLat);
			let bestTrack = -1;
			let bestDistance = radiusPx ** 2;
			this.stamp = (this.stamp + 1) >>> 0;
			if (!this.stamp) { this.seen.fill(0); this.stamp = 1; }
			for (let row = a.row; row <= b.row; row += 1) {
				for (let col = a.col; col <= b.col; col += 1) {
					for (const segment of this.cells[row * this.columns + col]) {
						if (this.seen[segment] === this.stamp) continue;
						this.seen[segment] = this.stamp;
						const track = this.owner[segment];
						if (!filteredBit[track] || (onlyTrack >= 0 && track !== onlyTrack)) continue;
						const distance = pointSegmentDistanceSquared(
							screenX, screenY,
							projectX(this.x1[segment]), projectY(this.y1[segment]),
							projectX(this.x2[segment]), projectY(this.y2[segment])
						);
						if (distance < bestDistance) { bestDistance = distance; bestTrack = track; }
					}
				}
			}
			return bestTrack;
		}
	}

	function buildFilterControls() {
		const monthCounts = Array(12).fill(0);
		const regionCounts = Array(REGION_LABELS.length).fill(0);
		const genesisRegionCounts = Array(GENESIS_REGIONS.length).fill(0);
		for (let i = 0; i < META.ntracks; i += 1) {
			monthCounts[CAT.month[i] - 1] += 1;
			regionCounts[CAT.dom[i]] += 1;
			genesisRegionCounts[genesisRegionByTrack[i]] += 1;
		}
		$("#wdMonthChips").innerHTML = MONTHS.map((month, index) =>
			`<button class="mla-chip" type="button" data-month="${index + 1}" aria-pressed="false">${month}<span class="mla-sr-only"> (${monthCounts[index].toLocaleString()} catalogue systems)</span></button>`
		).join("");
		$("#wdRegionChips").innerHTML = REGION_LABELS.map((region, index) =>
			`<button class="mla-chip" type="button" data-region="${index}" aria-pressed="false"><span class="mla-swatch" style="background:${REGION_COLORS[index]}"></span>${region}<span class="wd-footnote">${regionCounts[index].toLocaleString()}</span></button>`
		).join("");
		$("#wdGenesisRegionChips").innerHTML = GENESIS_REGIONS.map((region, index) =>
			`<button class="mla-chip" type="button" data-genesis-region="${index}" aria-pressed="false">${region.label}<span class="wd-footnote">${genesisRegionCounts[index].toLocaleString()}</span></button>`
		).join("");
		syncControlsFromState();
	}

	function bindInterface() {
		$("#wdDownloadFixes").disabled = selected < 0;
		$$('[role="tab"][data-tab]').forEach((button) => {
			button.addEventListener("click", () => switchTab(button.dataset.tab));
			button.addEventListener("keydown", handleTabKey);
		});
		$("#wdSearch").addEventListener("input", (event) => {
			state.query = event.target.value.trim();
			scheduleFilters();
		});
		$("#wdTimeModeYears").addEventListener("click", () => setTimeMode("years"));
		$("#wdTimeModeDates").addEventListener("click", () => setTimeMode("dates"));
		$("#wdYearMin").addEventListener("change", (event) => {
			state.yearMin = clamp(Number(event.target.value) || Math.min(...CAT.year), Math.min(...CAT.year), state.yearMax);
			syncControlsFromState();
			applyFilters();
		});
		$("#wdYearMax").addEventListener("change", (event) => {
			state.yearMax = clamp(Number(event.target.value) || Math.max(...CAT.year), state.yearMin, Math.max(...CAT.year));
			syncControlsFromState();
			applyFilters();
		});
		$("#wdDateMin").addEventListener("change", (event) => {
			state.dateMin = event.target.value || DEFAULT_DATE_MIN;
			if (state.dateMin > state.dateMax) state.dateMax = state.dateMin;
			syncControlsFromState();
			applyFilters();
		});
		$("#wdDateMax").addEventListener("change", (event) => {
			state.dateMax = event.target.value || DEFAULT_DATE_MAX;
			if (state.dateMax < state.dateMin) state.dateMin = state.dateMax;
			syncControlsFromState();
			applyFilters();
		});
		for (const [id, key] of [["#wdLengthMin", "lengthMin"], ["#wdDurationMin", "durationMin"]]) {
			$(id).addEventListener("change", (event) => {
				state[key] = Number(event.target.value) || 0;
				applyFilters();
			});
		}
		$("#wdIntensityMin").addEventListener("input", (event) => {
			state.intensityMin = Number(event.target.value);
			$("#wdIntensityOutput").textContent = `P${state.intensityMin}+`;
			scheduleFilters();
		});
		$("#wdRainMin").addEventListener("input", (event) => {
			state.rainMin = Number(event.target.value);
			$("#wdRainOutput").textContent = `P${state.rainMin}+`;
			scheduleFilters();
		});
		$("#wdSeasonPresets").addEventListener("click", (event) => {
			const button = event.target.closest("[data-season]");
			if (!button || !SEASONS[button.dataset.season]) return;
			state.months = new Set(SEASONS[button.dataset.season]);
			syncMonthChips();
			syncSeasonButtons();
			applyFilters();
		});
		$("#wdMonthChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-month]");
			if (!button) return;
			const month = Number(button.dataset.month);
			if (state.months.has(month)) {
				if (state.months.size > 1) state.months.delete(month);
			} else {
				state.months.add(month);
			}
			syncMonthChips();
			syncSeasonButtons();
			applyFilters();
		});
		$("#wdGenesisRegionChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-genesis-region]");
			if (!button) return;
			const region = Number(button.dataset.genesisRegion);
			state.genesisRegions.has(region) ? state.genesisRegions.delete(region) : state.genesisRegions.add(region);
			syncGenesisRegionChips();
			applyFilters();
		});
		$("#wdRegionChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-region]");
			if (!button) return;
			const region = Number(button.dataset.region);
			state.regions.has(region) ? state.regions.delete(region) : state.regions.add(region);
			syncRegionChips();
			applyFilters();
		});
		$("#wdResetFilters").addEventListener("click", resetFilters);
		$("#wdShare").addEventListener("click", copyViewLink);

		$("#wdMapLayer").addEventListener("change", (event) => {
			state.mapLayer = event.target.value;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdMapColour").addEventListener("change", (event) => {
			state.mapColour = event.target.value;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdWeatherLayer").addEventListener("change", (event) => {
			state.weatherLayer = event.target.value;
			weatherError = "";
			weatherLoadSerial += 1;
			weatherMonth = "";
			weatherField = "";
			updateWeatherControls();
			if (state.weatherLayer === "none") drawMapWeather();
			else syncWeatherToFocus();
			scheduleUrlUpdate();
		});
		$("#wdRegionBoxes").addEventListener("change", (event) => {
			state.showRegionBoxes = event.target.checked;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdZoomOut").addEventListener("click", () => zoomMap(0.72));
		$("#wdZoomIn").addEventListener("click", () => zoomMap(1.38));
		$("#wdZoomReset").addEventListener("click", resetMapView);
		$("#wdFitSubset").addEventListener("click", fitSubset);

		$("#wdPreviousFix").addEventListener("click", () => setFocusFix(focusFix - 1));
		$("#wdNextFix").addEventListener("click", () => setFocusFix(focusFix + 1));
		$("#wdTrackFix").addEventListener("input", (event) => setFocusFix(Number(event.target.value)));
		$("#wdRetryWeather").addEventListener("click", () => {
			weatherError = "";
			weatherMonth = "";
			weatherField = "";
			syncWeatherToFocus();
		});
		$("#wdEvolutionMetric").addEventListener("change", () => { drawLifeChart(); scheduleUrlUpdate(); });
		$("#wdProfileMetric").addEventListener("change", () => { drawProfileChart(); scheduleUrlUpdate(); });
		$("#wdTableSort").addEventListener("change", () => { tablePage = 0; renderTable(); });
		$("#wdTablePrevious").addEventListener("click", () => { tablePage = Math.max(0, tablePage - 1); renderTable(); });
		$("#wdTableNext").addEventListener("click", () => { tablePage += 1; renderTable(); });
		$("#wdExtremeMetric").addEventListener("change", renderExtremes);

		$("#wdDownloadSummaries").addEventListener("click", downloadSummaries);
		$("#wdDownloadGeojson").addEventListener("click", downloadGeoJson);
		$("#wdDownloadQuery").addEventListener("click", downloadQuery);
		$("#wdDownloadFixes").addEventListener("click", downloadSelectedFixes);

		window.addEventListener("resize", debounce(() => renderActiveTab(), 160));
		window.addEventListener("popstate", () => window.location.reload());
	}

	function scheduleFilters() {
		window.clearTimeout(filterTimer);
		filterTimer = window.setTimeout(() => applyFilters(), 90);
	}

	function setTimeMode(mode) {
		if (mode === state.timeMode) return;
		if (mode === "dates") {
			state.dateMin = `${state.yearMin}-01-01`;
			state.dateMax = `${state.yearMax}-12-31`;
		} else {
			state.yearMin = Number(state.dateMin.slice(0, 4));
			state.yearMax = Number(state.dateMax.slice(0, 4));
		}
		state.timeMode = mode;
		syncControlsFromState();
		applyFilters();
	}

	function resetFilters() {
		state.timeMode = "years";
		state.months = new Set(SEASONS.djfm);
		state.regions.clear();
		state.genesisRegions.clear();
		state.yearMin = Math.min(...CAT.year);
		state.yearMax = Math.max(...CAT.year);
		state.dateMin = DEFAULT_DATE_MIN;
		state.dateMax = DEFAULT_DATE_MAX;
		state.intensityMin = 0;
		state.rainMin = 0;
		state.lengthMin = 0;
		state.durationMin = 0;
		state.query = "";
		syncControlsFromState();
		applyFilters();
	}

	function syncControlsFromState() {
		$("#wdSearch").value = state.query;
		$("#wdYearFields").hidden = state.timeMode !== "years";
		$("#wdDateFields").hidden = state.timeMode !== "dates";
		$("#wdPeriodLabel").textContent = state.timeMode === "dates" ? "Track active dates" : "Genesis years";
		$("#wdTimeModeYears").setAttribute("aria-pressed", String(state.timeMode === "years"));
		$("#wdTimeModeDates").setAttribute("aria-pressed", String(state.timeMode === "dates"));
		$("#wdYearMin").value = state.yearMin;
		$("#wdYearMax").value = state.yearMax;
		$("#wdDateMin").value = state.dateMin;
		$("#wdDateMax").value = state.dateMax;
		$("#wdIntensityMin").value = state.intensityMin;
		$("#wdIntensityOutput").textContent = `P${state.intensityMin}+`;
		$("#wdRainMin").value = state.rainMin;
		$("#wdRainOutput").textContent = `P${state.rainMin}+`;
		$("#wdLengthMin").value = state.lengthMin;
		$("#wdDurationMin").value = state.durationMin;
		$("#wdMapLayer").value = state.mapLayer;
		$("#wdMapColour").value = state.mapColour;
		$("#wdWeatherLayer").value = state.weatherLayer;
		$("#wdRegionBoxes").checked = state.showRegionBoxes;
		updateWeatherControls();
		syncMonthChips();
		syncRegionChips();
		syncGenesisRegionChips();
		syncSeasonButtons();
	}

	function syncMonthChips() {
		$$('[data-month]', $("#wdMonthChips")).forEach((button) => {
			button.setAttribute("aria-pressed", String(state.months.has(Number(button.dataset.month))));
		});
	}

	function syncRegionChips() {
		$$('[data-region]', $("#wdRegionChips")).forEach((button) => {
			button.setAttribute("aria-pressed", String(state.regions.has(Number(button.dataset.region))));
		});
	}

	function syncGenesisRegionChips() {
		$$('[data-genesis-region]', $("#wdGenesisRegionChips")).forEach((button) => {
			button.setAttribute("aria-pressed", String(state.genesisRegions.has(Number(button.dataset.genesisRegion))));
		});
	}

	function syncSeasonButtons() {
		$$('[data-season]', $("#wdSeasonPresets")).forEach((button) => {
			button.setAttribute("aria-pressed", String(sameSet(state.months, new Set(SEASONS[button.dataset.season] || []))));
		});
	}

	function applyFilters(options = {}) {
		const minimumActive = state.timeMode === "dates" ? Date.parse(`${state.dateMin}T00:00:00Z`) : NaN;
		const maximumActive = state.timeMode === "dates" ? Date.parse(`${state.dateMax}T23:59:59.999Z`) : NaN;
		const useRegions = state.regions.size > 0;
		const useGenesisRegions = state.genesisRegions.size > 0;
		const query = state.query.toLowerCase();
		const dateQuery = /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : "";
		const compactQuery = query.replace(/[^a-z0-9]/g, "");
		const next = [];
		for (let i = 0; i < META.ntracks; i += 1) {
			if (!state.months.has(CAT.month[i])) continue;
			if (state.timeMode === "dates") {
				if (lysisMillis(i) < minimumActive || genesisMillis(i) > maximumActive) continue;
			} else if (CAT.year[i] < state.yearMin || CAT.year[i] > state.yearMax) continue;
			if (CAT.pct_int[i] < state.intensityMin || CAT.pct_pr[i] < state.rainMin) continue;
			if (CAT.len_km[i] < state.lengthMin || CAT.dur[i] < state.durationMin) continue;
			if (useRegions && !state.regions.has(CAT.dom[i])) continue;
			if (useGenesisRegions && !state.genesisRegions.has(genesisRegionByTrack[i])) continue;
			if (query) {
				if (dateQuery) {
					if (genesisDate(i) !== dateQuery) continue;
				} else {
					const searchable = `${trackNames[i]} ${CAT.id[i]}`.toLowerCase().replace(/[^a-z0-9]/g, "");
					if (!searchable.includes(compactQuery)) continue;
				}
			}
			next.push(i);
		}
		filtered = next;
		filteredBit.fill(0);
		for (const index of filtered) filteredBit[index] = 1;
		if (options.resetPage !== false) tablePage = 0;
		updateFilterSummary();
		updateStats();
		renderTable();
		renderDossier();
		renderActiveTab();
		scheduleUrlUpdate();
	}

	function updateFilterSummary() {
		$("#wdResultCount").innerHTML = `<strong>${filtered.length.toLocaleString()}</strong> of ${META.ntracks.toLocaleString()} disturbances`;
		const pieces = [];
		if (state.intensityMin) pieces.push(`vorticity P${state.intensityMin}+`);
		if (state.rainMin) pieces.push(`precipitation P${state.rainMin}+`);
		if (state.genesisRegions.size) pieces.push(`${state.genesisRegions.size} genesis region${state.genesisRegions.size === 1 ? "" : "s"}`);
		if (state.regions.size) pieces.push(`${state.regions.size} impact region${state.regions.size === 1 ? "" : "s"}`);
		$("#wdFilterBadge").textContent = pieces.length ? pieces.join(" · ") : describeMonths();
	}

	function describeMonths() {
		const match = Object.entries(SEASONS).find(([, values]) => sameSet(state.months, new Set(values)));
		return match ? match[0].toUpperCase() : `${state.months.size} selected months`;
	}

	function updateStats() {
		let intensity = 0;
		let rain = 0;
		let duration = 0;
		for (const index of filtered) {
			intensity += CAT.pk_int[index];
			rain += CAT.pk_pr[index];
			duration += CAT.dur[index];
		}
		const count = filtered.length || 1;
		const cards = [
			["Systems", filtered.length.toLocaleString(), `${(filtered.length / META.ntracks * 100).toFixed(1)}% of catalogue`],
			["Mean peak ζ", filtered.length ? (intensity / count).toFixed(1) : "—", "10⁻⁵ s⁻¹ · 450–300 hPa"],
			["Mean peak precipitation", filtered.length ? (rain / count).toFixed(1) : "—", "mm · track-centred 24 h"],
			["Mean lifetime", filtered.length ? Math.round(duration / count).toLocaleString() : "—", "hours"]
		];
		$("#wdStats").innerHTML = cards.map(([label, value, note]) => `<div class="mla-card mla-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
	}

	function switchTab(tab, options = {}) {
		if (!$( `[data-panel="${tab}"]` )) tab = "explore";
		activeTab = tab;
		$$('[role="tab"][data-tab]').forEach((button) => {
			const active = button.dataset.tab === tab;
			button.setAttribute("aria-selected", String(active));
			button.tabIndex = active ? 0 : -1;
		});
		$$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
		renderActiveTab();
		if (options.updateUrl !== false) scheduleUrlUpdate();
	}

	function handleTabKey(event) {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const tabs = $$('[role="tab"][data-tab]');
		let index = tabs.indexOf(event.currentTarget);
		if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
		if (event.key === "ArrowLeft") index = (index - 1 + tabs.length) % tabs.length;
		if (event.key === "Home") index = 0;
		if (event.key === "End") index = tabs.length - 1;
		tabs[index].focus();
		switchTab(tabs[index].dataset.tab);
	}

	function renderActiveTab() {
		if (!DATA) return;
		if (activeTab === "explore") {
			sizeMap();
			drawMap();
			drawLifeChart();
			drawProfileChart();
		} else if (activeTab === "climatology") {
			drawClimatology();
		} else if (activeTab === "extremes") {
			renderExtremes();
		}
	}

	function setupMap() {
		map.base = $("#wdMapBase");
		map.weather = $("#wdMapWeather");
		map.data = $("#wdMapData");
		map.overlay = $("#mlaMapOverlay");
		map.baseContext = map.base.getContext("2d");
		map.weatherContext = map.weather.getContext("2d");
		map.dataContext = map.data.getContext("2d");
		map.overlayContext = map.overlay.getContext("2d");

		map.overlay.addEventListener("pointerdown", (event) => {
			map.drag = { x: event.clientX, y: event.clientY, view: { ...map.view }, pointerId: event.pointerId };
			map.moved = false;
			map.overlay.setPointerCapture(event.pointerId);
			map.overlay.classList.add("is-dragging");
		});
		map.overlay.addEventListener("pointermove", (event) => {
			if (map.drag) {
				const dx = event.clientX - map.drag.x;
				const dy = event.clientY - map.drag.y;
				if (Math.hypot(dx, dy) > 3) map.moved = true;
				const spanLon = map.drag.view.east - map.drag.view.west;
				const spanLat = map.drag.view.north - map.drag.view.south;
				map.view.west = map.drag.view.west - dx / map.width * spanLon;
				map.view.east = map.drag.view.east - dx / map.width * spanLon;
				map.view.south = map.drag.view.south + dy / map.height * spanLat;
				map.view.north = map.drag.view.north + dy / map.height * spanLat;
				clampMapView();
				drawMap();
			} else {
				handleMapHover(event);
			}
		});
		map.overlay.addEventListener("pointerup", (event) => {
			if (map.drag && !map.moved) selectMapFeature(event);
			map.drag = null;
			map.overlay.classList.remove("is-dragging");
			try { map.overlay.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
			scheduleUrlUpdate();
		});
		map.overlay.addEventListener("pointercancel", () => {
			map.drag = null;
			map.overlay.classList.remove("is-dragging");
		});
		map.overlay.addEventListener("pointerleave", () => {
			if (!map.drag) {
				hovered = -1;
				hideMapTip();
				drawMapOverlay();
			}
		});
		map.overlay.addEventListener("wheel", (event) => {
			event.preventDefault();
			const rect = map.overlay.getBoundingClientRect();
			const focus = screenToLonLat(event.clientX - rect.left, event.clientY - rect.top);
			zoomMap(event.deltaY < 0 ? 1.25 : 0.8, focus);
		}, { passive: false });
	}

	function sizeMap() {
		const rect = $("#wdMapStack").getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return false;
		map.width = rect.width;
		map.height = rect.height;
		map.dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia("(max-width:760px)").matches ? 1.5 : 2);
		for (const canvas of [map.base, map.weather, map.data, map.overlay]) {
			canvas.width = Math.round(map.width * map.dpr);
			canvas.height = Math.round(map.height * map.dpr);
		}
		for (const context of [map.baseContext, map.weatherContext, map.dataContext, map.overlayContext]) {
			context.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
		}
		return true;
	}

	function drawMap() {
		if (!map.base || map.width < 2) return;
		drawMapBase();
		drawMapWeather();
		drawMapData();
		drawMapOverlay();
	}

	function drawMapBase() {
		const context = map.baseContext;
		context.clearRect(0, 0, map.width, map.height);
		context.fillStyle = css("--mla-sea", "#e7eee7");
		context.fillRect(0, 0, map.width, map.height);
		context.save();
		context.strokeStyle = "rgba(43, 33, 25, .14)";
		context.fillStyle = "rgba(43, 33, 25, .58)";
		context.lineWidth = 1;
		context.font = "10px effra, Arial, sans-serif";
		for (let lon = Math.ceil(map.view.west / 10) * 10; lon <= map.view.east; lon += 10) {
			const x = projectX(lon);
			context.beginPath(); context.moveTo(x, 0); context.lineTo(x, map.height); context.stroke();
			context.fillText(`${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`, x + 4, map.height - 8);
		}
		for (let lat = Math.ceil(map.view.south / 10) * 10; lat <= map.view.north; lat += 10) {
			const y = projectY(lat);
			context.beginPath(); context.moveTo(0, y); context.lineTo(map.width, y); context.stroke();
			context.fillText(`${Math.abs(lat)}°${lat < 0 ? "S" : "N"}`, 5, y - 5);
		}
		context.restore();

		drawContextLines(context, window.WD_COAST_LINES || [], "rgba(53, 70, 62, .60)", 1.15);
		drawContextLines(context, window.WD_BORDER_LINES || [], "rgba(78, 60, 43, .46)", 0.8);
		if (state.showRegionBoxes) drawImpactBoxes(context);
	}

	function weatherSettings(field) {
		const configuredBases = CONFIG.weatherBases || {};
		const configuredBounds = CONFIG.weatherBounds || {};
		const configuredSteps = CONFIG.weatherSteps || {};
		return {
			base: String(configuredBases[field] || CONFIG.weatherBase || "").replace(/\/$/, ""),
			bounds: Array.isArray(configuredBounds[field]) ? configuredBounds[field].map(Number) : [19.875, 5.125, 109.875, 55.125],
			stepHours: Number(configuredSteps[field]) || 3,
			fps: Number(CONFIG.weatherFps) || 6
		};
	}

	function focusTimeMillis() {
		return selected < 0 ? NaN : genesisMillis(selected) + focusFix * CONFIG.stepHours * HOUR_MS;
	}

	function weatherMonthForTime(timeMillis) {
		const value = new Date(timeMillis).toISOString();
		return value.slice(0, 4) + value.slice(5, 7);
	}

	function weatherMonthStart(month) {
		return Date.parse(`${month.slice(0, 4)}-${month.slice(4, 6)}-01T00:00:00Z`);
	}

	function ensureWeatherVideo() {
		if (weatherVideo) return weatherVideo;
		weatherVideo = document.createElement("video");
		weatherVideo.crossOrigin = "anonymous";
		weatherVideo.muted = true;
		weatherVideo.playsInline = true;
		weatherVideo.preload = "auto";
		weatherVideo.addEventListener("seeked", drawMapWeather);
		weatherVideo.addEventListener("loadeddata", drawMapWeather);
		weatherVideo.addEventListener("canplay", drawMapWeather);
		weatherVideo.addEventListener("error", () => {
			if (!weatherField) return;
			weatherError = unavailableWeatherMessage(weatherField, weatherMonth);
			weatherLoading = false;
			updateWeatherControls();
			drawMapWeather();
		});
		return weatherVideo;
	}

	function waitForVideoEvent(video, eventName, failureMessage, timeoutMillis) {
		return new Promise((resolve, reject) => {
			let timer;
			const cleanup = () => {
				window.clearTimeout(timer);
				video.removeEventListener(eventName, ready);
				video.removeEventListener("error", failed);
			};
			const ready = () => { cleanup(); resolve(video); };
			const failed = () => { cleanup(); reject(new Error(failureMessage)); };
			video.addEventListener(eventName, ready, { once: true });
			video.addEventListener("error", failed, { once: true });
			timer = window.setTimeout(() => { cleanup(); reject(new Error(`${failureMessage} (timed out)`)); }, timeoutMillis);
		});
	}

	function weatherUrl(month, field) {
		const settings = weatherSettings(field);
		const extension = CONFIG.weatherFormat || "webm";
		return settings.base ? `${settings.base}/${field}/${month.slice(0, 4)}/${month}.${extension}` : "";
	}

	async function loadWeatherMonth(timeMillis) {
		const month = weatherMonthForTime(timeMillis);
		const field = state.weatherLayer;
		const video = ensureWeatherVideo();
		if (weatherField === field && weatherMonth === month && video.readyState >= 1) return video;
		const url = weatherUrl(month, field);
		if (!url) throw new Error("The weather-data URL is not configured");
		const serial = ++weatherLoadSerial;
		weatherError = "";
		weatherMonth = month;
		weatherField = field;
		const loading = waitForVideoEvent(video, "loadedmetadata", `Could not load ${month} ${WEATHER_FIELDS[field].label}`, 20000);
		video.src = url;
		video.load();
		await loading;
		if (serial !== weatherLoadSerial) throw new Error("Superseded weather request");
		return video;
	}

	async function seekWeather(timeMillis) {
		const video = await loadWeatherMonth(timeMillis);
		const settings = weatherSettings(weatherField);
		const frame = Math.round((timeMillis - weatherMonthStart(weatherMonth)) / (settings.stepHours * HOUR_MS));
		const target = Math.max(0, frame / settings.fps + 0.001 / settings.fps);
		if (Math.abs(video.currentTime - target) < 0.25 / settings.fps) {
			drawMapWeather();
			return;
		}
		const seeking = waitForVideoEvent(video, "seeked", `Could not seek ${weatherMonth} ${WEATHER_FIELDS[weatherField].label}`, 15000);
		video.currentTime = target;
		await seeking;
		drawMapWeather();
	}

	async function syncWeatherToFocus() {
		const timeMillis = focusTimeMillis();
		if (state.weatherLayer === "none" || !Number.isFinite(timeMillis)) {
			weatherLoading = false;
			updateWeatherControls();
			drawMapWeather();
			return;
		}
		const serial = ++weatherSyncSerial;
		weatherError = "";
		weatherLoading = true;
		updateWeatherControls();
		try {
			await seekWeather(timeMillis);
		} catch (error) {
			if (String(error && error.message).includes("Superseded")) return;
			if (serial !== weatherSyncSerial) return;
			if (!weatherError) weatherError = error && error.message ? `${error.message}. No weather overlay is shown.` : String(error);
		} finally {
			if (serial === weatherSyncSerial) weatherLoading = false;
		}
		if (serial === weatherSyncSerial) updateWeatherControls();
	}

	const scheduleWeatherSync = debounce(syncWeatherToFocus, 80);

	function updateWeatherControls() {
		const definition = WEATHER_FIELDS[state.weatherLayer];
		const key = $("#wdWeatherKey");
		const mapMessage = $("#wdWeatherMessage");
		key.hidden = !definition;
		$("#wdRetryWeather").hidden = !weatherError;
		$("#wdWeatherLayer").value = state.weatherLayer;
		if (definition) {
			$("#wdWeatherKeyMin").textContent = definition.keyMin;
			$("#wdWeatherKeyMax").textContent = definition.keyMax;
			$("#wdWeatherRamp").dataset.field = state.weatherLayer;
		}
		let message = "";
		if (weatherError) message = weatherError;
		else if (weatherLoading && definition) message = `Loading ${definition.label} for ${formatTrackTime(selected, focusFix)}…`;
		else if (definition && selected >= 0) message = `${definition.label} · ${formatTrackTime(selected, focusFix)}`;
		else if (definition) message = "Select a track to choose the weather time.";
		$("#wdWeatherStatus").textContent = message;
		mapMessage.hidden = !(weatherError || (weatherLoading && definition));
		mapMessage.textContent = weatherError || (weatherLoading && definition ? `Loading ${definition.label}…` : "");
		mapMessage.dataset.tone = weatherError ? "error" : "loading";
		$("#wdTimeControls").hidden = selected < 0 && state.weatherLayer === "none";
		$("#wdTrackFix").disabled = selected < 0;
		$("#wdPreviousFix").disabled = selected < 0 || focusFix <= 0;
		$("#wdNextFix").disabled = selected < 0 || focusFix >= (selected < 0 ? 0 : OFF[selected][1] - 1);
	}

	function unavailableWeatherMessage(field, month) {
		const definition = WEATHER_FIELDS[field];
		const monthLabel = /^\d{6}$/.test(month) ? `${MONTHS[Number(month.slice(4, 6)) - 1]} ${month.slice(0, 4)}` : month;
		if (field === "vorticity350") return `No 350-hPa vorticity is available for ${monthLabel} yet. The public archive is being backfilled; no weather overlay is shown.`;
		return `${definition ? definition.label : "Weather"} is unavailable for ${monthLabel}. No weather overlay is shown.`;
	}

	function maskedWeatherFrame() {
		const encodedWidth = weatherVideo.videoWidth;
		const height = weatherVideo.videoHeight;
		const width = Math.floor(encodedWidth / 2);
		if (!width || !height || encodedWidth !== width * 2) return null;
		if (!weatherFrameCanvas) {
			weatherFrameCanvas = document.createElement("canvas");
			weatherFrameContext = weatherFrameCanvas.getContext("2d", { willReadFrequently: true });
			weatherEncodedCanvas = document.createElement("canvas");
			weatherEncodedContext = weatherEncodedCanvas.getContext("2d", { willReadFrequently: true });
		}
		if (weatherFrameCanvas.width !== width || weatherFrameCanvas.height !== height) {
			weatherFrameCanvas.width = width; weatherFrameCanvas.height = height;
			weatherEncodedCanvas.width = encodedWidth; weatherEncodedCanvas.height = height;
		}
		weatherEncodedContext.clearRect(0, 0, encodedWidth, height);
		weatherEncodedContext.drawImage(weatherVideo, 0, 0, encodedWidth, height);
		const encoded = weatherEncodedContext.getImageData(0, 0, encodedWidth, height);
		const frame = weatherFrameContext.createImageData(width, height);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const target = (y * width + x) * 4;
				const colour = (y * encodedWidth + x) * 4;
				const mask = (y * encodedWidth + x + width) * 4;
				frame.data[target] = encoded.data[colour];
				frame.data[target + 1] = encoded.data[colour + 1];
				frame.data[target + 2] = encoded.data[colour + 2];
				frame.data[target + 3] = encoded.data[mask] <= 8 ? 0 : encoded.data[mask];
			}
		}
		weatherFrameContext.putImageData(frame, 0, 0);
		return weatherFrameCanvas;
	}

	function drawMapWeather() {
		if (!map.weatherContext) return;
		map.weatherContext.clearRect(0, 0, map.width, map.height);
		if (state.weatherLayer === "none" || selected < 0 || !weatherVideo || weatherVideo.readyState < 2 || weatherError) return;
		const [west, south, east, north] = weatherSettings(state.weatherLayer).bounds;
		map.weatherContext.save();
		map.weatherContext.globalAlpha = 0.88;
		map.weatherContext.imageSmoothingEnabled = false;
		try {
			const frame = maskedWeatherFrame();
			if (frame) map.weatherContext.drawImage(frame, projectX(west), projectY(north), projectX(east) - projectX(west), projectY(south) - projectY(north));
		} catch (_) {
			weatherError = "The browser could not draw this cross-origin weather frame";
			updateWeatherControls();
		}
		map.weatherContext.restore();
	}

	function drawContextLines(context, lines, stroke, width) {
		context.save();
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.lineJoin = "round";
		context.lineCap = "round";
		for (const line of lines) {
			if (line.length < 4) continue;
			context.beginPath();
			for (let i = 0; i < line.length; i += 2) {
				const x = projectX(line[i] / 10);
				const y = projectY(line[i + 1] / 10);
				i === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
			}
			context.stroke();
		}
		context.restore();
	}

	function drawImpactBoxes(context) {
		context.save();
		context.setLineDash([4, 4]);
		context.font = "10px effra, Arial, sans-serif";
		context.textBaseline = "top";
		REGION_BOXES.forEach((box, index) => {
			const x = projectX(box[0]);
			const x2 = projectX(box[1]);
			const y = projectY(box[3]);
			const y2 = projectY(box[2]);
			context.fillStyle = withAlpha(REGION_COLORS[index], 0.075);
			context.strokeStyle = withAlpha(REGION_COLORS[index], 0.62);
			context.fillRect(x, y, x2 - x, y2 - y);
			context.strokeRect(x, y, x2 - x, y2 - y);
			context.fillStyle = REGION_COLORS[index];
			context.fillText(REGION_LABELS[index], x + 3, y + 3);
		});
		context.restore();
	}

	function drawMapData() {
		const context = map.dataContext;
		context.clearRect(0, 0, map.width, map.height);
		map.rendered = [];
		const layer = resolvedMapLayer();
		if (layer === "density") drawDensity(context);
		else if (layer === "tracks") drawTracks(context);
		else if (layer === "none") map.rendered = selected < 0 ? [] : [selected];
		else drawEndpoints(context, layer === "lysis");
		updateMapLegend(layer);
	}

	function resolvedMapLayer() {
		return state.mapLayer === "auto" ? (filtered.length > 700 ? "density" : "tracks") : state.mapLayer;
	}

	function drawDensity(context) {
		const grid = new Map();
		for (const index of filtered) {
			const [start, length] = OFF[index];
			const cells = new Set();
			for (let j = 0; j < length; j += 1) {
				const point = start + j;
				const lon = Math.floor(PLON[point] / 100);
				const lat = Math.floor(PLAT[point] / 100);
				cells.add(`${lon},${lat}`);
			}
			for (const key of cells) grid.set(key, (grid.get(key) || 0) + 1);
		}
		const maximum = Math.max(1, ...grid.values());
		for (const [key, count] of grid) {
			const [lon, lat] = key.split(",").map(Number);
			if (lon + 1 < map.view.west || lon > map.view.east || lat + 1 < map.view.south || lat > map.view.north) continue;
			const x = projectX(lon);
			const y = projectY(lat + 1);
			const width = projectX(lon + 1) - x + 0.5;
			const height = projectY(lat) - y + 0.5;
			context.fillStyle = densityColour(Math.sqrt(count / maximum));
			context.fillRect(x, y, width, height);
		}
	}

	function drawTracks(context) {
		let list = filtered;
		if (list.length > MAP_TRACK_LIMIT) {
			const sampled = [];
			const step = list.length / MAP_TRACK_LIMIT;
			for (let cursor = 0; cursor < list.length; cursor += step) sampled.push(list[Math.floor(cursor)]);
			if (selected >= 0 && !sampled.includes(selected)) sampled.push(selected);
			list = sampled;
		}
		map.rendered = list;
		const alpha = list.length > 4000 ? 0.16 : list.length > 1200 ? 0.26 : list.length > 300 ? 0.43 : 0.76;
		const width = list.length > 2000 ? 0.7 : list.length > 500 ? 0.9 : 1.25;
		context.save();
		context.lineJoin = "round";
		context.lineCap = "round";
		for (let renderedIndex = 0; renderedIndex < list.length; renderedIndex += 1) {
			const index = list[renderedIndex];
			drawTrackPath(context, index, colourForTrack(index), width, alpha);
		}
		context.restore();
	}

	function drawEndpoints(context, useLysis) {
		let list = filtered;
		if (list.length > 12000) {
			const step = list.length / 12000;
			list = Array.from({ length: 12000 }, (_, i) => list[Math.floor(i * step)]);
		}
		map.rendered = list;
		for (let renderedIndex = 0; renderedIndex < list.length; renderedIndex += 1) {
			const index = list[renderedIndex];
			const [start, length] = OFF[index];
			const point = useLysis ? start + length - 1 : start;
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			context.beginPath();
			context.arc(x, y, filtered.length > 3000 ? 1.5 : 2.5, 0, Math.PI * 2);
			context.fillStyle = withAlpha(colourForTrack(index), filtered.length > 3000 ? 0.45 : 0.78);
			context.fill();
		}
	}

	function drawTrackPath(context, index, stroke, width, alpha) {
		const [start, length] = OFF[index];
		context.beginPath();
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			j === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
		}
		context.globalAlpha = alpha;
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.stroke();
		context.globalAlpha = 1;
	}

	function drawMapOverlay() {
		const context = map.overlayContext;
		context.clearRect(0, 0, map.width, map.height);
		if (hovered >= 0 && hovered !== selected) drawHighlightedTrack(context, hovered, "#fffaf0", 3, false);
		if (selected >= 0) {
			context.save();
			context.lineJoin = "round";
			context.lineCap = "round";
			drawTrackPath(context, selected, css("--mla-card", "#fffaf0"), 6.4, 0.95);
			context.restore();
			drawHighlightedTrack(context, selected, css("--mla-ink", "#17130f"), 3.2, true);
		}
	}

	function drawHighlightedTrack(context, index, colour, width, showFocus) {
		context.save();
		context.shadowColor = "rgba(23, 41, 79, .55)";
		context.shadowBlur = 8;
		drawTrackPath(context, index, colour, width, 1);
		context.shadowBlur = 0;
		const [start, length] = OFF[index];
		const genesis = [projectX(PLON[start] / 100), projectY(PLAT[start] / 100)];
		const lysis = [projectX(PLON[start + length - 1] / 100), projectY(PLAT[start + length - 1] / 100)];
		context.lineWidth = 2;
		context.strokeStyle = colour;
		context.fillStyle = css("--mla-card", "#fffaf0");
		context.beginPath(); context.arc(genesis[0], genesis[1], 4.5, 0, Math.PI * 2); context.fill(); context.stroke();
		context.fillStyle = colour;
		context.beginPath(); context.arc(lysis[0], lysis[1], 4.5, 0, Math.PI * 2); context.fill();
		if (showFocus) {
			const point = start + clamp(focusFix, 0, length - 1);
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			const radius = 6 + clamp((PVORT[point] / 10 - 10) / 8, 0, 6);
			context.fillStyle = withAlpha(vorticityColour(PVORT[point] / 10), 0.22);
			context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
			context.fillStyle = vorticityColour(PVORT[point] / 10);
			context.strokeStyle = css("--mla-card", "#fffaf0");
			context.lineWidth = 2;
			context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
		}
		context.restore();
	}

	function handleMapHover(event) {
		const index = mapHitTest(event.clientX, event.clientY, 9);
		if (index !== hovered) {
			hovered = index;
			drawMapOverlay();
		}
		if (index < 0) {
			hideMapTip();
			return;
		}
		const rect = $("#wdMapStack").getBoundingClientRect();
		const tip = $("#wdMapTip");
		tip.innerHTML = `<strong>${trackName(index)}</strong><br>${formatGenesis(index)} · ${REGION_LONG[CAT.dom[index]]}<br>Peak ζ ${CAT.pk_int[index].toFixed(1)} ×10⁻⁵ s⁻¹ (P${Math.round(CAT.pct_int[index])}) · ${CAT.pk_pr[index].toFixed(1)} mm`;
		tip.style.left = `${event.clientX - rect.left}px`;
		tip.style.top = `${event.clientY - rect.top}px`;
		tip.dataset.visible = "true";
	}

	function hideMapTip() {
		$("#wdMapTip").dataset.visible = "false";
	}

	function selectMapFeature(event) {
		const touch = event.pointerType === "touch" || window.matchMedia("(pointer:coarse)").matches;
		const index = mapHitTest(event.clientX, event.clientY, touch ? 22 : 11);
		if (index < 0) return;
		const rect = map.overlay.getBoundingClientRect();
		const nearest = nearestFix(index, event.clientX - rect.left, event.clientY - rect.top);
		selectTrack(index, { fit: false, focusFix: nearest });
	}

	function mapHitTest(clientX, clientY, tolerance) {
		if (!filtered.length) return -1;
		const rect = map.overlay.getBoundingClientRect();
		const screenX = clientX - rect.left;
		const screenY = clientY - rect.top;
		const layer = resolvedMapLayer();
		if (layer === "genesis" || layer === "lysis") {
			let best = -1;
			let bestDistance = tolerance ** 2;
			for (const index of filtered) {
				const [start, length] = OFF[index];
				const point = layer === "lysis" ? start + length - 1 : start;
				const distance = (projectX(PLON[point] / 100) - screenX) ** 2 + (projectY(PLAT[point] / 100) - screenY) ** 2;
				if (distance < bestDistance) { bestDistance = distance; best = index; }
			}
			return best;
		}
		const radius = layer === "density" ? Math.max(tolerance, 16) : tolerance;
		if (layer === "none" && selected < 0) return -1;
		return segmentIndex.query(screenX, screenY, radius, layer === "none" ? selected : -1);
	}

	function nearestFix(index, screenX, screenY) {
		const [start, length] = OFF[index];
		let nearest = 0;
		let distance = Infinity;
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const dx = projectX(PLON[point] / 100) - screenX;
			const dy = projectY(PLAT[point] / 100) - screenY;
			const next = dx * dx + dy * dy;
			if (next < distance) { distance = next; nearest = j; }
		}
		return nearest;
	}

	function updateMapLegend(layer) {
		const legend = $("#wdMapLegend");
		if (layer === "density") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#d7e7df,#08736f,#17294f)"></span>Unique-track density · 1° cells</span>';
		} else if (layer === "none") {
			legend.innerHTML = '<span class="mla-legend-item">Selected track only</span>';
		} else if (state.mapColour === "region") {
			legend.innerHTML = REGION_LABELS.map((label, index) => `<span class="mla-legend-item"><span class="mla-swatch" style="background:${REGION_COLORS[index]}"></span>${label}</span>`).join("");
		} else if (state.mapColour === "intensity") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#3978a8,#08736f,#c3931d,#aa3d2d,#8f2938)"></span>Peak 450–300 hPa vorticity percentile</span>';
		} else if (state.mapColour === "year") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#233f78,#08736f,#c3931d,#aa3d2d)"></span>Genesis year · 1950–2025</span>';
		} else {
			legend.innerHTML = `<span class="mla-legend-item"><span class="mla-swatch" style="background:${css("--mla-atlas-blue", "#3978a8")}"></span>${layer === "tracks" ? "Individual trajectories" : layer === "genesis" ? "Genesis locations" : "Lysis locations"}</span>`;
		}
		if (selected >= 0) legend.insertAdjacentHTML("beforeend", `<span class="mla-legend-item"><span class="mla-swatch" style="background:${css("--mla-ink", "#17130f")}"></span>Selected trajectory</span><span class="wd-map-marker-key"><i></i><i></i> genesis / lysis</span>`);
	}

	function colourForTrack(index) {
		if (state.mapColour === "region") return REGION_COLORS[CAT.dom[index]];
		if (state.mapColour === "intensity") return percentileColour(CAT.pct_int[index]);
		if (state.mapColour === "year") return yearColour(CAT.year[index]);
		return css("--mla-atlas-blue", "#3978a8");
	}

	function projectX(lon) { return (lon - map.view.west) / (map.view.east - map.view.west) * map.width; }
	function projectY(lat) { return (map.view.north - lat) / (map.view.north - map.view.south) * map.height; }
	function screenToLonLat(x, y) {
		return {
			lon: map.view.west + x / map.width * (map.view.east - map.view.west),
			lat: map.view.north - y / map.height * (map.view.north - map.view.south)
		};
	}

	function zoomMap(factor, focus = null) {
		const center = focus || { lon: (map.view.west + map.view.east) / 2, lat: (map.view.south + map.view.north) / 2 };
		const nextWidth = clamp((map.view.east - map.view.west) / factor, 6, DEFAULT_VIEW.east - DEFAULT_VIEW.west + 30);
		const nextHeight = clamp((map.view.north - map.view.south) / factor, 4, DEFAULT_VIEW.north - DEFAULT_VIEW.south + 20);
		const fx = (center.lon - map.view.west) / (map.view.east - map.view.west);
		const fy = (map.view.north - center.lat) / (map.view.north - map.view.south);
		map.view.west = center.lon - fx * nextWidth;
		map.view.east = map.view.west + nextWidth;
		map.view.north = center.lat + fy * nextHeight;
		map.view.south = map.view.north - nextHeight;
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function clampMapView() {
		const lonSpan = map.view.east - map.view.west;
		const latSpan = map.view.north - map.view.south;
		if (map.view.west < -20) { map.view.west = -20; map.view.east = map.view.west + lonSpan; }
		if (map.view.east > 145) { map.view.east = 145; map.view.west = map.view.east - lonSpan; }
		if (map.view.south < -10) { map.view.south = -10; map.view.north = map.view.south + latSpan; }
		if (map.view.north > 75) { map.view.north = 75; map.view.south = map.view.north - latSpan; }
	}

	function resetMapView() {
		map.view = { ...DEFAULT_VIEW };
		drawMap();
		scheduleUrlUpdate();
	}

	function fitSubset() {
		if (!filtered.length) return;
		let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
		for (const index of filtered) {
			const [start, length] = OFF[index];
			for (let j = 0; j < length; j += 1) {
				const point = start + j;
				const lon = PLON[point] / 100;
				const lat = PLAT[point] / 100;
				west = Math.min(west, lon); east = Math.max(east, lon);
				south = Math.min(south, lat); north = Math.max(north, lat);
			}
		}
		const lonPad = Math.max(2, (east - west) * 0.06);
		const latPad = Math.max(1.5, (north - south) * 0.08);
		map.view = { west: west - lonPad, east: east + lonPad, south: south - latPad, north: north + latPad };
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function selectTrack(index, options = {}) {
		if (index < 0 || index >= META.ntracks) return;
		const changed = selected !== index;
		selected = index;
		if (changed) {
			if (Number.isInteger(options.focusFix)) {
				focusFix = clamp(options.focusFix, 0, OFF[index][1] - 1);
			} else {
				const [start, length] = OFF[index];
				let peak = 0;
				for (let j = 1; j < length; j += 1) {
					if (PVORT[start + j] > PVORT[start + peak]) peak = j;
				}
				focusFix = peak;
			}
		} else if (Number.isInteger(options.focusFix)) {
			focusFix = clamp(options.focusFix, 0, OFF[index][1] - 1);
		}
		const length = OFF[index][1];
		$("#wdTrackFix").max = Math.max(0, length - 1);
		$("#wdTrackFix").value = focusFix;
		$("#wdTimeControls").hidden = false;
		$("#wdDownloadFixes").disabled = false;
		renderDossier();
		renderTable();
		updateFocusReadout();
		if (state.weatherLayer !== "none") syncWeatherToFocus();
		drawMap();
		drawLifeChart();
		if (options.fit) fitSelectedTrack(index);
		if (options.updateUrl !== false) scheduleUrlUpdate();
	}

	function clearSelection() {
		selected = -1;
		hovered = -1;
		focusFix = 0;
		weatherSyncSerial += 1;
		weatherLoading = false;
		$("#wdTimeControls").hidden = state.weatherLayer === "none";
		$("#wdDownloadFixes").disabled = true;
		renderDossier();
		renderTable();
		drawMap();
		drawLifeChart();
		updateWeatherControls();
		scheduleUrlUpdate();
	}

	function fitSelectedTrack(index) {
		const [start, length] = OFF[index];
		let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const lon = PLON[point] / 100;
			const lat = PLAT[point] / 100;
			west = Math.min(west, lon); east = Math.max(east, lon);
			south = Math.min(south, lat); north = Math.max(north, lat);
		}
		const lonPad = Math.max(2, (east - west) * 0.12);
		const latPad = Math.max(1.5, (north - south) * 0.16);
		map.view = { west: west - lonPad, east: east + lonPad, south: south - latPad, north: north + latPad };
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function setFocusFix(value) {
		if (selected < 0) return;
		focusFix = clamp(value, 0, OFF[selected][1] - 1);
		$("#wdTrackFix").value = focusFix;
		updateFocusReadout();
		drawMapOverlay();
		drawLifeChart();
		if (state.weatherLayer !== "none") scheduleWeatherSync();
	}

	function updateFocusReadout() {
		if (selected < 0) return;
		const [start] = OFF[selected];
		const point = start + focusFix;
		$("#wdFocusTime").textContent = `${formatTrackTime(selected, focusFix)} · ${(PLAT[point] / 100).toFixed(2)}°N, ${(PLON[point] / 100).toFixed(2)}°E`;
		$("#wdFocusVort").textContent = `${(PVORT[point] / 10).toFixed(1)} ×10⁻⁵ s⁻¹`;
		$("#wdPreviousFix").disabled = focusFix <= 0;
		$("#wdNextFix").disabled = focusFix >= OFF[selected][1] - 1;
		updateWeatherControls();
	}

	function renderDossier() {
		const dossier = $("#wdDossier");
		if (selected < 0) {
			dossier.innerHTML = '<p class="mla-dossier-empty">Select a track on the map or from a table to open its dossier.</p>';
			return;
		}
		const index = selected;
		const [start, length] = OFF[index];
		const last = start + length - 1;
		const regionValues = REGION_KEYS.map((key) => Number(CAT[key][index]) || 0);
		const maximumRegion = Math.max(1, ...regionValues);
		dossier.innerHTML = `
			<div class="mla-dossier-head">
				<div><span class="mla-badge" data-tone="official">${trackName(index)}</span><h3>${formatGenesis(index)}</h3><p class="mla-dossier-sub">Catalogue ID ${CAT.id[index]} · Genesis region: ${GENESIS_REGIONS[genesisRegionByTrack[index]].longLabel}<br><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> Dominant precipitation: ${REGION_LONG[CAT.dom[index]]}</p></div>
				<button class="mla-btn mla-btn-icon mla-btn-small" id="wdCloseDossier" type="button" aria-label="Close dossier">×</button>
			</div>
			<div class="mla-fact-grid">
				<div class="mla-fact"><span>Peak 450–300 hPa ζ</span><strong>${CAT.pk_int[index].toFixed(1)}</strong><small>10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}</small></div>
				<div class="mla-fact"><span>Peak 24 h precipitation</span><strong>${CAT.pk_pr[index].toFixed(1)} mm</strong><small>P${Math.round(CAT.pct_pr[index])}</small></div>
				<div class="mla-fact"><span>Path length</span><strong>${Math.round(CAT.len_km[index]).toLocaleString()} km</strong><small>P${Math.round(CAT.pct_len[index])}</small></div>
				<div class="mla-fact"><span>Lifetime</span><strong>${CAT.dur[index]} h</strong><small>${length} three-hourly fixes</small></div>
				<div class="mla-fact"><span>Genesis</span><strong class="wd-coordinate">${(PLAT[start] / 100).toFixed(2)}°N</strong><small>${(PLON[start] / 100).toFixed(2)}°E</small></div>
				<div class="mla-fact"><span>Lysis</span><strong class="wd-coordinate">${(PLAT[last] / 100).toFixed(2)}°N</strong><small>${(PLON[last] / 100).toFixed(2)}°E · ${formatTrackTime(index, length - 1)}</small></div>
			</div>
			<div class="mla-match-box"><h4>Peak regional 24 h precipitation</h4><div class="wd-region-list">${regionValues.map((value, region) => `<div class="wd-region-row"><span>${REGION_LABELS[region]}</span><span class="wd-region-bar"><i style="width:${value / maximumRegion * 100}%;background:${REGION_COLORS[region]}"></i></span><strong>${value.toFixed(1)} mm</strong></div>`).join("")}</div></div>
			<div class="mla-dossier-actions"><button class="mla-btn mla-btn-small" id="wdFitSelected" type="button">Fit track on map</button><button class="mla-btn mla-btn-small" id="wdDossierDownload" type="button">Download fixes</button></div>`;
		$("#wdCloseDossier").addEventListener("click", clearSelection);
		$("#wdFitSelected").addEventListener("click", () => fitSelectedTrack(index));
		$("#wdDossierDownload").addEventListener("click", downloadSelectedFixes);
	}

	function renderTable() {
		if (!CAT) return;
		const sort = $("#wdTableSort").value;
		const direction = sort === "date" ? -1 : -1;
		const ordered = filtered.slice().sort((a, b) => (tableSortValue(a, sort) - tableSortValue(b, sort)) * direction || CAT.id[a] - CAT.id[b]);
		const pages = Math.max(1, Math.ceil(ordered.length / TABLE_PAGE_SIZE));
		tablePage = clamp(tablePage, 0, pages - 1);
		const start = tablePage * TABLE_PAGE_SIZE;
		const rows = ordered.slice(start, start + TABLE_PAGE_SIZE);
		const table = $("#wdTopTable");
		table.tHead.innerHTML = '<tr><th>Track</th><th>Genesis</th><th>Dominant precipitation region</th><th class="mla-num">Peak ζ</th><th class="mla-num">Peak precipitation</th><th class="mla-num">Length</th><th class="mla-num">Duration</th></tr>';
		table.tBodies[0].innerHTML = rows.map((index) => `<tr data-index="${index}" data-selected="${index === selected}"><td><button class="mla-row-button" type="button">${trackName(index)}</button></td><td>${formatGenesis(index)}</td><td><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> ${REGION_LABELS[CAT.dom[index]]}</td><td class="mla-num">${CAT.pk_int[index].toFixed(1)} <span class="wd-footnote">P${Math.round(CAT.pct_int[index])}</span></td><td class="mla-num">${CAT.pk_pr[index].toFixed(1)} mm</td><td class="mla-num">${Math.round(CAT.len_km[index]).toLocaleString()} km</td><td class="mla-num">${CAT.dur[index]} h</td></tr>`).join("");
		$$('[data-index]', table.tBodies[0]).forEach((row) => row.addEventListener("click", () => selectTrack(Number(row.dataset.index), { fit: false })));
		$("#wdTablePage").textContent = ordered.length ? `Showing ${start + 1}–${Math.min(start + TABLE_PAGE_SIZE, ordered.length)} of ${ordered.length.toLocaleString()} · page ${tablePage + 1} of ${pages}` : "No systems match the filters";
		$("#wdTablePrevious").disabled = tablePage === 0;
		$("#wdTableNext").disabled = tablePage >= pages - 1;
	}

	function tableSortValue(index, sort) {
		if (sort === "intensity") return CAT.pk_int[index];
		if (sort === "rain") return CAT.pk_pr[index];
		if (sort === "length") return CAT.len_km[index];
		if (sort === "duration") return CAT.dur[index];
		return genesisMillis(index);
	}

	function drawLifeChart() {
		const canvas = $("#wdLifeChart");
		const chart = prepareCanvas(canvas);
		if (!chart) return;
		const { context, width, height } = chart;
		if (selected < 0) {
			drawEmptyChart(context, width, height, "Select a disturbance to inspect its three-hourly evolution.");
			$("#wdLifeData").innerHTML = "";
			return;
		}
		const points = trackPoints(selected);
		const metric = $("#wdEvolutionMetric").value;
		const descriptor = EVOLUTION_METRICS[metric] || EVOLUTION_METRICS.vorticity;
		const values = points.map((point) => evolutionValue(point, metric));
		const rains = points.map((point) => point.rain ?? 0);
		const range = metricRange(values, descriptor.zeroBased);
		const plot = chartFrame(context, width, height, {
			left: 52,
			right: metric === "vorticity" ? 46 : 22,
			top: 25,
			bottom: 42,
			yMin: range.minimum,
			yMax: range.maximum,
			yLabel: descriptor.yLabel,
			xLabel: "Hours since genesis"
		});
		const y = (value) => plot.bottom - (value - plot.yMin) / (plot.yMax - plot.yMin) * plot.height;
		const x = (index) => plot.left + (points.length === 1 ? plot.width / 2 : index / (points.length - 1) * plot.width);
		if (metric === "vorticity") {
			const rainMax = Math.max(1, ...rains);
			const barWidth = Math.max(1, plot.width / points.length * 0.58);
			context.fillStyle = "rgba(57, 120, 168, .28)";
			points.forEach((point, index) => {
				if (!point.rain) return;
				const barHeight = point.rain / rainMax * plot.height * 0.72;
				context.fillRect(x(index) - barWidth / 2, plot.bottom - barHeight, barWidth, barHeight);
			});
			context.save();
			context.fillStyle = css("--mla-atlas-blue", "#3978a8");
			context.font = "11px effra, Arial, sans-serif";
			context.textAlign = "right";
			context.fillText(`precipitation max ${rainMax.toFixed(1)} mm`, width - 10, 16);
			context.restore();
		}
		drawLineSeries(context, values, x, y, css(descriptor.colour, descriptor.fallback), true, plot);
		const markerX = x(focusFix);
		const markerY = y(values[focusFix]);
		context.strokeStyle = css("--mla-indigo", "#233f78");
		context.lineWidth = 1;
		context.setLineDash([4, 4]);
		context.beginPath(); context.moveTo(markerX, plot.top); context.lineTo(markerX, plot.bottom); context.stroke();
		context.setLineDash([]);
		context.fillStyle = css("--mla-indigo-deep", "#17294f");
		context.beginPath(); context.arc(markerX, markerY, 4, 0, Math.PI * 2); context.fill();
		$("#wdLifeReadout").textContent = `${formatTrackTime(selected, focusFix)} · ${descriptor.label} ${formatEvolutionValue(values[focusFix], descriptor)}`;
		$("#wdLifeData").innerHTML = accessibleTable(
			["UTC", "Latitude", "Longitude", "450–300 hPa vorticity (10^-5 s^-1)", "24 h precipitation (mm)", "Translation speed (m s^-1)", "Cumulative path (km)", "Displacement from genesis (km)"],
			points.map((point, index) => [formatTrackTime(selected, index), point.lat.toFixed(2), point.lon.toFixed(2), point.vorticity.toFixed(1), formatNumber(point.rain, 2), point.speed.toFixed(1), point.path.toFixed(0), point.displacement.toFixed(0)])
		);
	}

	function drawProfileChart() {
		const canvas = $("#wdProfileChart");
		const chart = prepareCanvas(canvas);
		if (!chart) return;
		const { context, width, height } = chart;
		if (!filtered.length) {
			drawEmptyChart(context, width, height, "No systems match the current filters.");
			return;
		}
		const metric = $("#wdProfileMetric").value;
		const descriptor = EVOLUTION_METRICS[metric] || EVOLUTION_METRICS.vorticity;
		const binCount = 21;
		const bins = Array.from({ length: binCount }, () => []);
		for (const index of filtered) {
			const points = trackPoints(index);
			const length = points.length;
			const sums = Array(binCount).fill(0);
			const counts = Array(binCount).fill(0);
			for (let j = 0; j < length; j += 1) {
				const bin = length === 1 ? 0 : Math.round(j / (length - 1) * (binCount - 1));
				const value = evolutionValue(points[j], metric);
				if (value == null || !Number.isFinite(value)) continue;
				sums[bin] += value;
				counts[bin] += 1;
			}
			for (let bin = 0; bin < binCount; bin += 1) if (counts[bin]) bins[bin].push(sums[bin] / counts[bin]);
		}
		const summary = bins.map((values, index) => {
			values.sort((a, b) => a - b);
			return { life: index * 5, q1: quantile(values, 0.25), median: quantile(values, 0.5), q3: quantile(values, 0.75), n: values.length };
		});
		const range = metricRange(summary.flatMap((row) => [row.q1, row.q3]), descriptor.zeroBased);
		const plot = chartFrame(context, width, height, { left: 52, right: 22, top: 22, bottom: 42, yMin: range.minimum, yMax: range.maximum, yLabel: descriptor.yLabel, xLabel: "Life fraction (%)" });
		const x = (index) => plot.left + index / (binCount - 1) * plot.width;
		const y = (value) => plot.bottom - (value - plot.yMin) / (plot.yMax - plot.yMin) * plot.height;
		context.beginPath();
		summary.forEach((row, index) => index === 0 ? context.moveTo(x(index), y(row.q3 ?? plot.yMin)) : context.lineTo(x(index), y(row.q3 ?? plot.yMin)));
		for (let index = summary.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(summary[index].q1 ?? plot.yMin));
		context.closePath();
		context.fillStyle = withAlpha(css(descriptor.colour, descriptor.fallback), 0.19);
		context.fill();
		drawLineSeries(context, summary.map((row) => row.median ?? plot.yMin), x, y, css(descriptor.colour, descriptor.fallback), false, plot);
		$("#wdProfileReadout").textContent = `${filtered.length.toLocaleString()} systems · line is median; shading is interquartile range`;
		$("#wdProfileData").innerHTML = accessibleTable(["Life fraction (%)", "Systems", `Lower-quartile ${descriptor.label}`, `Median ${descriptor.label}`, `Upper-quartile ${descriptor.label}`], summary.map((row) => [row.life, row.n, formatNumber(row.q1, descriptor.decimals), formatNumber(row.median, descriptor.decimals), formatNumber(row.q3, descriptor.decimals)]));
	}

	function drawClimatology() {
		drawAnnualChart();
		drawMonthChart();
		drawRegionChart();
		drawGenesisChart();
	}

	function drawAnnualChart() {
		const chart = prepareCanvas($("#wdAnnualChart"));
		if (!chart) return;
		const years = [];
		for (let year = Math.min(...CAT.year); year <= Math.max(...CAT.year); year += 1) years.push(year);
		const counts = new Map(years.map((year) => [year, 0]));
		for (const index of filtered) counts.set(CAT.year[index], (counts.get(CAT.year[index]) || 0) + 1);
		const values = years.map((year) => counts.get(year));
		const plot = chartFrame(chart.context, chart.width, chart.height, { left: 48, right: 20, top: 22, bottom: 40, yMax: niceMaximum(values), yLabel: "Genesis systems", xLabel: "Genesis year" });
		const barWidth = plot.width / years.length;
		chart.context.fillStyle = withAlpha(css("--mla-indigo", "#233f78"), 0.72);
		values.forEach((value, index) => {
			const height = value / plot.yMax * plot.height;
			chart.context.fillRect(plot.left + index * barWidth, plot.bottom - height, Math.max(1, barWidth - 0.7), height);
		});
		chart.context.fillStyle = css("--mla-muted", "#665d52");
		chart.context.font = "11px effra, Arial, sans-serif";
		chart.context.textAlign = "center";
		for (let year = Math.ceil(years[0] / 10) * 10; year <= years.at(-1); year += 10) {
			const x = plot.left + (year - years[0] + 0.5) / years.length * plot.width;
			chart.context.fillText(String(year), x, plot.bottom + 17);
		}
		$("#wdAnnualData").innerHTML = accessibleTable(["Year", "Genesis systems"], years.map((year) => [year, counts.get(year)]));
	}

	function drawMonthChart() {
		const chart = prepareCanvas($("#wdMonthChart"));
		if (!chart) return;
		const counts = Array(12).fill(0);
		const intensity = Array(12).fill(0);
		for (const index of filtered) {
			const month = CAT.month[index] - 1;
			counts[month] += 1;
			intensity[month] += CAT.pk_int[index];
		}
		const means = counts.map((count, month) => count ? intensity[month] / count : 0);
		const plot = chartFrame(chart.context, chart.width, chart.height, { left: 48, right: 44, top: 23, bottom: 40, yMax: niceMaximum(counts), yLabel: "Genesis systems", xLabel: "Genesis month" });
		const barWidth = plot.width / 12;
		counts.forEach((value, month) => {
			const height = value / plot.yMax * plot.height;
			chart.context.fillStyle = withAlpha(css("--mla-indigo", "#233f78"), state.months.has(month + 1) ? 0.72 : 0.22);
			chart.context.fillRect(plot.left + month * barWidth + 2, plot.bottom - height, barWidth - 4, height);
		});
		const meanMaximum = Math.max(1, ...means) * 1.12;
		const x = (index) => plot.left + (index + 0.5) * barWidth;
		const y = (value) => plot.bottom - value / meanMaximum * plot.height;
		drawLineSeries(chart.context, means, x, y, css("--mla-madder", "#aa3d2d"), false, plot);
		chart.context.fillStyle = css("--mla-muted", "#665d52");
		chart.context.font = "11px effra, Arial, sans-serif";
		chart.context.textAlign = "center";
		MONTHS.forEach((month, index) => chart.context.fillText(month, x(index), plot.bottom + 17));
		chart.context.textAlign = "right";
		chart.context.fillStyle = css("--mla-madder", "#aa3d2d");
		chart.context.fillText(`mean ζ · max ${Math.max(...means).toFixed(1)}`, chart.width - 8, 15);
		$("#wdMonthData").innerHTML = accessibleTable(["Month", "Genesis systems", "Mean peak vorticity (10^-5 s^-1)"], MONTHS.map((month, index) => [month, counts[index], means[index].toFixed(2)]));
	}

	function drawRegionChart() {
		const chart = prepareCanvas($("#wdRegionChart"));
		if (!chart) return;
		const counts = Array(REGION_LABELS.length).fill(0);
		for (const index of filtered) counts[CAT.dom[index]] += 1;
		const maximum = Math.max(1, ...counts);
		const left = 116;
		const right = 35;
		const top = 22;
		const rowHeight = (chart.height - top - 24) / counts.length;
		chart.context.font = "12px effra, Arial, sans-serif";
		counts.forEach((value, index) => {
			const y = top + index * rowHeight;
			const width = (chart.width - left - right) * value / maximum;
			chart.context.fillStyle = withAlpha(REGION_COLORS[index], 0.76);
			chart.context.fillRect(left, y + 5, width, rowHeight - 12);
			chart.context.fillStyle = css("--mla-ink", "#282119");
			chart.context.textAlign = "right";
			chart.context.fillText(REGION_LABELS[index], left - 8, y + rowHeight / 2 + 3);
			chart.context.textAlign = "left";
			chart.context.fillText(`${value.toLocaleString()} · ${filtered.length ? (value / filtered.length * 100).toFixed(1) : "0.0"}%`, left + width + 7, y + rowHeight / 2 + 3);
		});
		$("#wdRegionData").innerHTML = accessibleTable(["Dominant precipitation region", "Systems", "Share (%)"], REGION_LONG.map((label, index) => [label, counts[index], filtered.length ? (counts[index] / filtered.length * 100).toFixed(2) : "0.00"]));
	}

	function drawGenesisChart() {
		const chart = prepareCanvas($("#wdGenesisChart"));
		if (!chart) return;
		const { context, width, height } = chart;
		context.fillStyle = css("--mla-sea", "#e7eee7");
		context.fillRect(0, 0, width, height);
		const bounds = { west: 22, east: 109, south: 6, north: 54 };
		const x = (lon) => (lon - bounds.west) / (bounds.east - bounds.west) * width;
		const y = (lat) => (bounds.north - lat) / (bounds.north - bounds.south) * height;
		const grid = new Map();
		for (const index of filtered) {
			const lon = Math.floor(CAT.glon[index]);
			const lat = Math.floor(CAT.glat[index]);
			const key = `${lon},${lat}`;
			grid.set(key, (grid.get(key) || 0) + 1);
		}
		const maximum = Math.max(1, ...grid.values());
		for (const [key, value] of grid) {
			const [lon, lat] = key.split(",").map(Number);
			context.fillStyle = densityColour(Math.sqrt(value / maximum));
			context.fillRect(x(lon), y(lat + 1), x(lon + 1) - x(lon) + 0.5, y(lat) - y(lat + 1) + 0.5);
		}
		drawProjectedContext(context, window.WD_COAST_LINES || [], x, y, "rgba(53, 70, 62, .62)", 1.1);
		drawProjectedContext(context, window.WD_BORDER_LINES || [], x, y, "rgba(78, 60, 43, .43)", 0.75);
		context.fillStyle = "rgba(40, 33, 25, .74)";
		context.font = "11px effra, Arial, sans-serif";
		context.fillText(`maximum ${maximum.toLocaleString()} genesis systems per 1° cell`, 12, 18);
	}

	function drawProjectedContext(context, lines, x, y, stroke, width) {
		context.save();
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.lineJoin = "round";
		for (const line of lines) {
			context.beginPath();
			for (let i = 0; i < line.length; i += 2) {
				const px = x(line[i] / 10);
				const py = y(line[i + 1] / 10);
				i === 0 ? context.moveTo(px, py) : context.lineTo(px, py);
			}
			context.stroke();
		}
		context.restore();
	}

	function renderExtremes() {
		if (!CAT) return;
		const metric = $("#wdExtremeMetric").value;
		const ordered = filtered.slice().sort((a, b) => extremeDirection(metric) * (extremeValue(b, metric) - extremeValue(a, metric)) || CAT.id[a] - CAT.id[b]);
		const leaders = ordered.slice(0, 3);
		$("#wdRecordCards").innerHTML = leaders.map((index, rank) => `<article class="mla-card mla-record" data-index="${index}"><span class="mla-eyebrow">Rank ${rank + 1}</span><h3><button class="mla-row-button" type="button">${trackName(index)}</button></h3><p>${formatGenesis(index)} · ${REGION_LONG[CAT.dom[index]]}</p><strong>${formatExtreme(index, metric)}</strong></article>`).join("") || '<p>No systems match the current filters.</p>';
		$$('[data-index]', $("#wdRecordCards")).forEach((card) => card.addEventListener("click", () => { selectTrack(Number(card.dataset.index), { fit: true }); switchTab("explore"); }));
		const table = $("#wdExtremeTable");
		table.tHead.innerHTML = `<tr><th>Rank</th><th>Track</th><th>Genesis</th><th>Dominant precipitation region</th><th class="mla-num">${extremeLabel(metric)}</th></tr>`;
		table.tBodies[0].innerHTML = ordered.slice(0, 50).map((index, rank) => `<tr data-index="${index}"><td>${rank + 1}</td><td><button class="mla-row-button" type="button">${trackName(index)}</button></td><td>${formatGenesis(index)}</td><td>${REGION_LONG[CAT.dom[index]]}</td><td class="mla-num">${formatExtreme(index, metric)}</td></tr>`).join("");
		$$('[data-index]', table.tBodies[0]).forEach((row) => row.addEventListener("click", () => { selectTrack(Number(row.dataset.index), { fit: true }); switchTab("explore"); }));
	}

	function extremeDirection(metric) {
		return ["southGenesis", "westGenesis"].includes(metric) ? -1 : 1;
	}

	function extremeValue(index, metric) {
		if (metric === "intensity") return CAT.pk_int[index];
		if (metric === "rain") return CAT.pk_pr[index];
		if (metric === "length") return CAT.len_km[index];
		if (metric === "duration") return CAT.dur[index];
		if (metric === "northGenesis" || metric === "southGenesis") return CAT.glat[index];
		return CAT.glon[index];
	}

	function extremeLabel(metric) {
		return ({ intensity: "Peak 450–300 hPa ζ", rain: "Peak 24 h precipitation", length: "Path length", duration: "Duration", northGenesis: "Genesis latitude", southGenesis: "Genesis latitude", eastGenesis: "Genesis longitude", westGenesis: "Genesis longitude" })[metric];
	}

	function formatExtreme(index, metric) {
		const value = extremeValue(index, metric);
		if (metric === "intensity") return `${value.toFixed(1)} ×10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}`;
		if (metric === "rain") return `${value.toFixed(1)} mm · P${Math.round(CAT.pct_pr[index])}`;
		if (metric === "length") return `${Math.round(value).toLocaleString()} km`;
		if (metric === "duration") return `${value} h`;
		if (metric === "northGenesis" || metric === "southGenesis") return `${value.toFixed(2)}°N`;
		return `${value.toFixed(2)}°E`;
	}

	function downloadSummaries() {
		const header = ["atlas_name", "track_id", "genesis_utc", "lysis_utc", "genesis_lon_deg_e", "genesis_lat_deg_n", "genesis_region", "lysis_lon_deg_e", "lysis_lat_deg_n", "fix_count", "duration_h", "path_length_km", "peak_vorticity_450_300hpa_1e-5_s-1", "vorticity_catalogue_percentile", "peak_24h_precipitation_mm", "precipitation_catalogue_percentile", "dominant_precipitation_region", "karakoram_peak_24h_mm", "hindu_kush_peak_24h_mm", "western_himalaya_peak_24h_mm", "central_himalaya_peak_24h_mm", "north_india_peak_24h_mm"];
		const rows = filtered.map((index) => {
			const [start, length] = OFF[index];
			const last = start + length - 1;
			return [trackName(index), CAT.id[index], isoTrackTime(index, 0), isoTrackTime(index, length - 1), PLON[start] / 100, PLAT[start] / 100, GENESIS_REGIONS[genesisRegionByTrack[index]].longLabel, PLON[last] / 100, PLAT[last] / 100, length, CAT.dur[index], CAT.len_km[index], CAT.pk_int[index], CAT.pct_int[index], CAT.pk_pr[index], CAT.pct_pr[index], REGION_LONG[CAT.dom[index]], ...REGION_KEYS.map((key) => CAT[key][index])];
		});
		downloadBlob(csvText(header, rows), "text/csv;charset=utf-8", exportName("summaries.csv"));
		showToast(`Prepared ${filtered.length.toLocaleString()} system summaries.`);
	}

	function downloadGeoJson() {
		showToast("Preparing GeoJSON…");
		const collection = {
			type: "FeatureCollection",
			name: "Filtered western disturbances",
			properties: { catalogue: CONFIG.catalogueVersion, generated_utc: new Date().toISOString(), filters: serialisableFilters() },
			features: filtered.map((index) => {
				const [start, length] = OFF[index];
				const coordinates = [];
				for (let j = 0; j < length; j += 1) coordinates.push([PLON[start + j] / 100, PLAT[start + j] / 100]);
				return {
					type: "Feature",
					id: CAT.id[index],
					properties: {
						atlas_name: trackName(index), track_id: CAT.id[index], genesis_utc: isoTrackTime(index, 0), lysis_utc: isoTrackTime(index, length - 1),
						genesis_region: GENESIS_REGIONS[genesisRegionByTrack[index]].longLabel,
						duration_h: CAT.dur[index], path_length_km: CAT.len_km[index],
						peak_vorticity_450_300hpa_1e5_s: CAT.pk_int[index], vorticity_percentile: CAT.pct_int[index],
						peak_24h_precipitation_mm: CAT.pk_pr[index], precipitation_percentile: CAT.pct_pr[index], dominant_precipitation_region: REGION_LONG[CAT.dom[index]]
					},
					geometry: { type: "LineString", coordinates }
				};
			})
		};
		downloadBlob(JSON.stringify(collection), "application/geo+json", exportName("tracks.geojson"));
	}

	function downloadQuery() {
		const payload = {
			schema: "western-disturbances-atlas-query-v1",
			catalogue: CONFIG.catalogueVersion,
			catalogue_asset: CONFIG.catalogue,
			fix_asset: CONFIG.fixes,
			generated_utc: new Date().toISOString(),
			result_count: filtered.length,
			selected_atlas_name: selected >= 0 ? trackName(selected) : null,
			selected_track_id: selected >= 0 ? CAT.id[selected] : null,
			filters: serialisableFilters(),
			view_url: window.location.href
		};
		downloadBlob(JSON.stringify(payload, null, 2) + "\n", "application/json", exportName("query.json"));
	}

	function downloadSelectedFixes() {
		if (selected < 0) {
			showToast("Select a disturbance before downloading fixes.");
			return;
		}
		const index = selected;
		const points = trackPoints(index);
		const rows = points.map((point, j) => [trackName(index), CAT.id[index], isoTrackTime(index, j), j * CONFIG.stepHours, point.lon, point.lat, point.vorticity, point.rain ?? "", point.speed, point.path, point.displacement]);
		downloadBlob(csvText(["atlas_name", "track_id", "time_utc", "hours_since_genesis", "longitude_deg_e", "latitude_deg_n", "vorticity_450_300hpa_1e-5_s-1", "precipitation_24h_mm", "translation_speed_m_s-1", "cumulative_path_km", "displacement_from_genesis_km"], rows), "text/csv;charset=utf-8", `${trackName(index).toLowerCase().replaceAll(" ", "-")}-fixes.csv`);
	}

	function serialisableFilters() {
		return {
			time_mode: state.timeMode,
			active_date_interval: state.timeMode === "dates" ? [state.dateMin, state.dateMax] : null,
			genesis_months: [...state.months].sort((a, b) => a - b),
			genesis_year: state.timeMode === "years" ? [state.yearMin, state.yearMax] : null,
			genesis_regions: [...state.genesisRegions].sort((a, b) => a - b).map((region) => GENESIS_REGIONS[region].longLabel),
			minimum_vorticity_catalogue_percentile: state.intensityMin,
			minimum_precipitation_catalogue_percentile: state.rainMin,
			minimum_path_length_km: state.lengthMin,
			minimum_duration_h: state.durationMin,
			dominant_precipitation_regions: [...state.regions].sort((a, b) => a - b).map((region) => REGION_LONG[region]),
			search: state.query || null
		};
	}

	function csvText(header, rows) {
		return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
	}

	function csvCell(value) {
		const text = value == null ? "" : String(value);
		return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	}

	function downloadBlob(content, type, filename) {
		const blob = content instanceof Blob ? content : new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function exportName(suffix) {
		return `western-disturbances-${new Date().toISOString().slice(0, 10)}-${suffix}`;
	}

	function readUrlState() {
		const params = new URLSearchParams(window.location.search);
		if (params.has("months")) {
			const months = params.get("months").split(",").map(Number).filter((month) => month >= 1 && month <= 12);
			if (months.length) state.months = new Set(months);
		}
		if (params.has("years")) {
			const [minimum, maximum] = params.get("years").split(/[,-]/).map(Number);
			if (Number.isFinite(minimum)) state.yearMin = clamp(minimum, Math.min(...CAT.year), Math.max(...CAT.year));
			if (Number.isFinite(maximum)) state.yearMax = clamp(maximum, Math.min(...CAT.year), Math.max(...CAT.year));
		}
		const dates = (params.get("dates") || "").split(",");
		if (dates.length === 2 && dates.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) && dates[0] <= dates[1]) {
			state.timeMode = "dates";
			state.dateMin = dates[0];
			state.dateMax = dates[1];
		}
		if (params.has("ip")) state.intensityMin = clamp(Number(params.get("ip")) || 0, 0, 99);
		if (params.has("rp")) state.rainMin = clamp(Number(params.get("rp")) || 0, 0, 99);
		if (params.has("length")) state.lengthMin = Math.max(0, Number(params.get("length")) || 0);
		if (params.has("duration")) state.durationMin = Math.max(0, Number(params.get("duration")) || 0);
		if (params.has("regions")) state.regions = new Set(params.get("regions").split(",").map(Number).filter((region) => region >= 0 && region < REGION_LABELS.length));
		if (params.has("genesis")) {
			const keys = params.get("genesis").split(",");
			state.genesisRegions = new Set(keys.map((key) => GENESIS_REGIONS.findIndex((region) => region.key === key)).filter((region) => region >= 0));
		}
		if (params.has("q")) state.query = params.get("q").slice(0, 60);
		if (["auto", "density", "tracks", "genesis", "lysis", "none"].includes(params.get("layer"))) state.mapLayer = params.get("layer");
		if (["single", "intensity", "region", "year"].includes(params.get("colour"))) state.mapColour = params.get("colour");
		if (["none", "vorticity350", "precipitation"].includes(params.get("weather"))) state.weatherLayer = params.get("weather");
		if (EVOLUTION_METRICS[params.get("evolve")]) $("#wdEvolutionMetric").value = params.get("evolve");
		if (EVOLUTION_METRICS[params.get("profile")]) $("#wdProfileMetric").value = params.get("profile");
		if (params.get("tracks") === "0") state.mapLayer = "none";
		if (params.get("boxes") === "0") state.showRegionBoxes = false;
		if (["explore", "climatology", "extremes", "data"].includes(params.get("tab"))) activeTab = params.get("tab");
		if (params.has("selected")) selected = idToIndex.get(params.get("selected")) ?? -1;
		if (params.has("view")) {
			const values = params.get("view").split(",").map(Number);
			if (values.length === 4 && values.every(Number.isFinite) && values[1] > values[0] && values[3] > values[2]) {
				map.view = { west: values[0], east: values[1], south: values[2], north: values[3] };
				clampMapView();
			}
		}
	}

	function scheduleUrlUpdate() {
		window.clearTimeout(urlTimer);
		urlTimer = window.setTimeout(updateUrl, 120);
	}

	function updateUrl() {
		if (!DATA) return;
		const params = new URLSearchParams();
		params.set("months", [...state.months].sort((a, b) => a - b).join(","));
		if (state.timeMode === "dates") params.set("dates", `${state.dateMin},${state.dateMax}`);
		else if (state.yearMin !== Math.min(...CAT.year) || state.yearMax !== Math.max(...CAT.year)) params.set("years", `${state.yearMin},${state.yearMax}`);
		if (state.intensityMin) params.set("ip", state.intensityMin);
		if (state.rainMin) params.set("rp", state.rainMin);
		if (state.lengthMin) params.set("length", state.lengthMin);
		if (state.durationMin) params.set("duration", state.durationMin);
		if (state.regions.size) params.set("regions", [...state.regions].sort((a, b) => a - b).join(","));
		if (state.genesisRegions.size) params.set("genesis", [...state.genesisRegions].sort((a, b) => a - b).map((region) => GENESIS_REGIONS[region].key).join(","));
		if (state.query) params.set("q", state.query);
		if (state.mapLayer !== "tracks") params.set("layer", state.mapLayer);
		if (state.mapColour !== "single") params.set("colour", state.mapColour);
		if (state.weatherLayer !== "none") params.set("weather", state.weatherLayer);
		if ($("#wdEvolutionMetric").value !== "vorticity") params.set("evolve", $("#wdEvolutionMetric").value);
		if ($("#wdProfileMetric").value !== "vorticity") params.set("profile", $("#wdProfileMetric").value);
		if (!state.showRegionBoxes) params.set("boxes", "0");
		if (activeTab !== "explore") params.set("tab", activeTab);
		if (selected >= 0) params.set("selected", CAT.id[selected]);
		if (!viewsEqual(map.view, DEFAULT_VIEW)) params.set("view", [map.view.west, map.view.east, map.view.south, map.view.north].map((value) => value.toFixed(2)).join(","));
		const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
		window.history.replaceState(null, "", next);
	}

	async function copyViewLink() {
		updateUrl();
		try {
			await navigator.clipboard.writeText(window.location.href);
			showToast("View link copied.");
		} catch (_) {
			window.prompt("Copy this atlas view link", window.location.href);
		}
	}

	function buildDerivedCatalogueFields() {
		trackNames = Array(META.ntracks);
		genesisRegionByTrack = new Uint8Array(META.ntracks);
		const years = new Map();
		for (let index = 0; index < META.ntracks; index += 1) {
			if (!years.has(CAT.year[index])) years.set(CAT.year[index], []);
			years.get(CAT.year[index]).push(index);
			genesisRegionByTrack[index] = classifyGenesisRegion(CAT.glon[index], CAT.glat[index]);
		}
		for (const [year, indices] of years) {
			indices.sort((a, b) => genesisMillis(a) - genesisMillis(b) || CAT.id[a] - CAT.id[b]);
			indices.forEach((index, sequence) => { trackNames[index] = `WD ${year} ${String(sequence + 1).padStart(3, "0")}`; });
		}
	}

	function classifyGenesisRegion(lon, lat) {
		const x = lon / 180;
		const y = Math.cos(lat * Math.PI / 180);
		let nearest = 0;
		let nearestDistance = Infinity;
		for (let region = 0; region < GENESIS_REGIONS.length - 1; region += 1) {
			const [cx, cy] = GENESIS_REGIONS[region].centre;
			const distance = (x - cx) ** 2 + (y - cy) ** 2;
			if (distance < nearestDistance) { nearestDistance = distance; nearest = region; }
		}
		const region = GENESIS_REGIONS[nearest];
		const dx = x - region.centre[0];
		const dy = y - region.centre[1];
		const [a, b, c, d] = region.inverse;
		const squaredDistance = dx * (a * dx + b * dy) + dy * (c * dx + d * dy);
		return squaredDistance <= region.cutoff ? nearest : GENESIS_REGIONS.length - 1;
	}

	function trackName(index) {
		return trackNames[index] || `WD ${CAT.year[index]} ${String(CAT.id[index]).padStart(3, "0")}`;
	}

	function trackPoints(index) {
		const [start, length] = OFF[index];
		const points = [];
		let path = 0;
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const lon = PLON[point] / 100;
			const lat = PLAT[point] / 100;
			const step = j ? haversineKm(points[j - 1].lon, points[j - 1].lat, lon, lat) : 0;
			path += step;
			points.push({
				lon,
				lat,
				vorticity: PVORT[point] / 10,
				rain: PRAIN[point] === -32768 ? null : PRAIN[point] / 100,
				speed: step * 1000 / (CONFIG.stepHours * 3600),
				path,
				displacement: j ? haversineKm(points[0].lon, points[0].lat, lon, lat) : 0
			});
		}
		return points;
	}

	function evolutionValue(point, metric) {
		return metric === "rain" ? point.rain : point[metric];
	}

	function formatEvolutionValue(value, descriptor) {
		return value == null || !Number.isFinite(value) ? "unavailable" : `${value.toFixed(descriptor.decimals)}${descriptor.unit}`;
	}

	function metricRange(values, zeroBased) {
		const finite = values.filter((value) => value != null && Number.isFinite(value));
		if (!finite.length) return { minimum: 0, maximum: 1 };
		if (zeroBased) return { minimum: 0, maximum: niceMaximum(finite) };
		let minimum = Math.min(...finite);
		let maximum = Math.max(...finite);
		if (maximum === minimum) { minimum -= 1; maximum += 1; }
		const rawStep = (maximum - minimum) / 4;
		const power = 10 ** Math.floor(Math.log10(rawStep));
		const scaled = rawStep / power;
		const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
		return { minimum: Math.floor(minimum / step) * step, maximum: Math.ceil(maximum / step) * step };
	}

	function haversineKm(lon1, lat1, lon2, lat2) {
		const radians = Math.PI / 180;
		const dLat = (lat2 - lat1) * radians;
		const dLon = (lon2 - lon1) * radians;
		const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
		return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
	}

	function genesisMillis(index) {
		return Date.UTC(CAT.year[index], CAT.month[index] - 1, CAT.day[index], CAT.hour[index]);
	}

	function lysisMillis(index) {
		return genesisMillis(index) + (OFF[index][1] - 1) * CONFIG.stepHours * HOUR_MS;
	}

	function genesisDate(index) {
		return new Date(genesisMillis(index)).toISOString().slice(0, 10);
	}

	function formatGenesis(index) {
		return `${String(CAT.day[index]).padStart(2, "0")} ${MONTHS[CAT.month[index] - 1]} ${CAT.year[index]} · ${String(CAT.hour[index]).padStart(2, "0")} UTC`;
	}

	function formatTrackTime(index, fix) {
		const date = new Date(genesisMillis(index) + fix * CONFIG.stepHours * 3600000);
		return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, "0")}:00 UTC`;
	}

	function isoTrackTime(index, fix) {
		return new Date(genesisMillis(index) + fix * CONFIG.stepHours * 3600000).toISOString().replace(".000Z", "Z");
	}

	function prepareCanvas(canvas) {
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return null;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		const context = canvas.getContext("2d");
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, rect.width, rect.height);
		return { context, width: rect.width, height: rect.height };
	}

	function chartFrame(context, width, height, options) {
		const left = options.left;
		const right = options.right;
		const top = options.top;
		const bottom = height - options.bottom;
		const plotWidth = width - left - right;
		const plotHeight = bottom - top;
		const yMin = Number.isFinite(options.yMin) ? options.yMin : 0;
		const yMax = Math.max(yMin + Number.EPSILON, options.yMax);
		context.save();
		context.font = "11px effra, Arial, sans-serif";
		context.strokeStyle = "rgba(40, 33, 25, .16)";
		context.fillStyle = css("--mla-muted", "#665d52");
		context.lineWidth = 1;
		for (let tick = 0; tick <= 4; tick += 1) {
			const y = top + tick / 4 * plotHeight;
			context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
			context.textAlign = "right";
			context.textBaseline = "middle";
			context.fillText(formatAxis(yMax - (yMax - yMin) * tick / 4), left - 7, y);
		}
		context.textAlign = "center";
		context.textBaseline = "alphabetic";
		context.fillText(options.xLabel, left + plotWidth / 2, height - 8);
		context.save();
		context.translate(13, top + plotHeight / 2);
		context.rotate(-Math.PI / 2);
		context.fillText(options.yLabel, 0, 0);
		context.restore();
		context.restore();
		return { left, right: width - right, top, bottom, width: plotWidth, height: plotHeight, yMin, yMax };
	}

	function drawLineSeries(context, values, x, y, colour, fill, plot) {
		if (!values.length) return;
		if (fill) {
			const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
			gradient.addColorStop(0, withAlpha(colour, 0.26));
			gradient.addColorStop(1, withAlpha(colour, 0.02));
			context.beginPath();
			context.moveTo(x(0), plot.bottom);
			values.forEach((value, index) => context.lineTo(x(index), y(value)));
			context.lineTo(x(values.length - 1), plot.bottom);
			context.closePath();
			context.fillStyle = gradient;
			context.fill();
		}
		context.beginPath();
		values.forEach((value, index) => index === 0 ? context.moveTo(x(index), y(value)) : context.lineTo(x(index), y(value)));
		context.strokeStyle = colour;
		context.lineWidth = 2.2;
		context.lineJoin = "round";
		context.lineCap = "round";
		context.stroke();
	}

	function drawEmptyChart(context, width, height, message) {
		context.fillStyle = css("--mla-muted", "#665d52");
		context.font = "13px effra, Arial, sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(message, width / 2, height / 2);
	}

	function accessibleTable(headers, rows) {
		return `<div class="mla-table-wrap"><table class="mla-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
	}

	function quantile(sorted, probability) {
		if (!sorted.length) return null;
		const position = (sorted.length - 1) * probability;
		const lower = Math.floor(position);
		const fraction = position - lower;
		return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
	}

	function niceMaximum(values) {
		const maximum = Math.max(1, ...values.filter(Number.isFinite));
		const power = 10 ** Math.floor(Math.log10(maximum));
		const scaled = maximum / power;
		const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
		return nice * power;
	}

	function formatAxis(value) {
		return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value >= 10 ? value.toFixed(0) : value.toFixed(1);
	}

	function formatNumber(value, decimals) {
		return value == null || !Number.isFinite(value) ? "NA" : value.toFixed(decimals);
	}

	function densityColour(value) {
		const stops = [[238, 239, 220], [150, 201, 178], [8, 115, 111], [23, 41, 79]];
		return interpolateStops(stops, clamp(value, 0, 1), 0.86);
	}

	function percentileColour(percentile) {
		const stops = [[57, 120, 168], [8, 115, 111], [195, 147, 29], [170, 61, 45], [143, 41, 56]];
		return interpolateStops(stops, clamp(percentile / 100, 0, 1), 1);
	}

	function yearColour(year) {
		const stops = [[35, 63, 120], [8, 115, 111], [195, 147, 29], [170, 61, 45]];
		return interpolateStops(stops, clamp((year - 1950) / 75, 0, 1), 1);
	}

	function vorticityColour(value) {
		return percentileColour(clamp((value - 10) / 45 * 100, 0, 100));
	}

	function interpolateStops(stops, value, alpha) {
		const position = value * (stops.length - 1);
		const lower = Math.min(stops.length - 2, Math.floor(position));
		const fraction = position - lower;
		const first = stops[lower];
		const second = stops[lower + 1];
		const channels = first.map((channel, index) => Math.round(channel + (second[index] - channel) * fraction));
		return `rgba(${channels[0]},${channels[1]},${channels[2]},${alpha})`;
	}

	function withAlpha(colour, alpha) {
		if (/^#[0-9a-f]{6}$/i.test(colour)) {
			const value = parseInt(colour.slice(1), 16);
			return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
		}
		const rgb = colour.match(/[\d.]+/g);
		return rgb && rgb.length >= 3 ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : colour;
	}

	function css(name, fallback) {
		return getComputedStyle($("#western-disturbances-atlas")).getPropertyValue(name).trim() || fallback;
	}

	function showToast(message) {
		const toast = $("#wdToast");
		toast.textContent = message;
		toast.dataset.visible = "true";
		window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => { toast.dataset.visible = "false"; }, 2600);
	}

	function debounce(callback, delay) {
		let timer = 0;
		return (...args) => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => callback(...args), delay);
		};
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
	}

	function sameSet(first, second) {
		return first.size === second.size && [...first].every((value) => second.has(value));
	}

	function viewsEqual(first, second) {
		return ["west", "east", "south", "north"].every((key) => Math.abs(first[key] - second[key]) < 0.01);
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}
})();
