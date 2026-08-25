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
	const LYSIS_REGIONS = Object.freeze([
		{ key: "west_60", label: "West of 60°E", test: (lon) => lon < 60 },
		{ key: "60_70", label: "60–70°E", test: (lon) => lon >= 60 && lon < 70 },
		{ key: "70_80", label: "70–80°E", test: (lon) => lon >= 70 && lon < 80 },
		{ key: "east_80", label: "East of 80°E", test: (lon) => lon >= 80 }
	]);
	const SERIES_COLOURS = ["#aa3d2d", "#233f78", "#08736f"];
	const VERTICAL_METRICS = Object.freeze({
		wind_speed: { label: "Wind speed", keys: ["wind_speed_850hpa", "wind_speed_700hpa", "wind_speed_500hpa"], unit: "m s⁻¹", decimals: 1 },
		temperature: { label: "Temperature", keys: ["temperature_850hpa_k", "temperature_700hpa_k", "temperature_500hpa_k"], unit: "K", decimals: 1 },
		relative_humidity: { label: "Relative humidity", keys: ["relative_humidity_850hpa_pct", "relative_humidity_700hpa_pct", "relative_humidity_500hpa_pct"], unit: "%", decimals: 0 },
		specific_humidity: { label: "Specific humidity", keys: ["specific_humidity_850hpa_g_kg", "specific_humidity_700hpa_g_kg", "specific_humidity_500hpa_g_kg"], unit: "g kg⁻¹", decimals: 2 },
		moisture_flux_magnitude: { label: "Moisture-flux magnitude", keys: ["moisture_flux_magnitude_850hpa_g_kg", "moisture_flux_magnitude_700hpa_g_kg", "moisture_flux_magnitude_500hpa_g_kg"], unit: "g kg⁻¹ m s⁻¹", decimals: 1 }
	});
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
		precipitation: { label: "trailing 24 h precipitation", keyMin: "0", keyMax: "150 mm" },
		wind500: { label: "500-hPa wind speed", keyMin: "0", keyMax: "65 m s⁻¹" },
		temperature500: { label: "500-hPa temperature", keyMin: "230", keyMax: "280 K" },
		humidity500: { label: "500-hPa specific humidity", keyMin: "0", keyMax: "5 g kg⁻¹" },
		mslp: { label: "mean-sea-level pressure", keyMin: "970", keyMax: "1045 hPa" }
	});
	const availableWeatherFields = new Set(["vorticity350", "precipitation"]);
	const EVOLUTION_METRICS = {
		vorticity: { label: "450–300 hPa vorticity", shortLabel: "ζ", yLabel: "450–300 hPa ζ (10⁻⁵ s⁻¹)", unit: " ×10⁻⁵ s⁻¹", decimals: 1, zeroBased: true, colour: "--mla-madder", fallback: "#aa3d2d" },
		rain: { label: "24 h precipitation", shortLabel: "precipitation", yLabel: "24 h precipitation (mm)", unit: " mm", decimals: 2, zeroBased: true, colour: "--mla-atlas-blue", fallback: "#3978a8" },
		speed: { label: "translation speed", shortLabel: "speed", yLabel: "Translation speed (m s⁻¹)", unit: " m s⁻¹", decimals: 1, zeroBased: true, colour: "--mla-turmeric", fallback: "#c3931d" },
		path: { label: "cumulative path length", shortLabel: "path", yLabel: "Cumulative path length (km)", unit: " km", decimals: 0, zeroBased: true, colour: "--mla-good", fallback: "#5c7d43" },
		displacement: { label: "displacement from genesis", shortLabel: "displacement", yLabel: "Displacement from genesis (km)", unit: " km", decimals: 0, zeroBased: true, colour: "--mla-purple", fallback: "#76558f" }
	};

	let DATA;
	let ROUTES;
	let CLIMATE;
	let JET;
	let CAT;
	let OFF;
	let META;
	let PLON;
	let PLAT;
	let PVORT;
	let PRAIN;
	let PTIME;
	const diagnosticArrays = new Map();
	const diagnosticPromises = new Map();
	const diagnosticErrors = new Map();
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
	let lysisRegionByTrack;
	let routeByTrack;
	let routeDefinitions = [];
	let spellByTrack;
	let spellSizeByTrack;
	let trackShapeFeatures;
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
	let mapTimeFocus = "";
	let mapTimeMatches = [];
	let lifeChartHit = null;
	let lifeChartDragging = false;
	let evolutionMetrics = ["vorticity"];
	let profileMetrics = ["vorticity", "rain"];
	const diagnosticSummaryCache = new Map();
	const trajectorySummaryCache = new Map();
	const catalogueProfileCache = new Map();
	const impactCache = new Map();
	const impactPromises = new Map();
	const impactErrors = new Map();
	let impactAvailableYears = new Set();

	const state = {
		timeMode: "years",
		months: new Set(SEASONS.djfm),
		regions: new Set(),
		genesisRegions: new Set(),
		lysisRegions: new Set(),
		routes: new Set(),
		yearMin: 1950,
		yearMax: 2025,
		yearBasis: "calendar",
		dateMin: DEFAULT_DATE_MIN,
		dateMax: DEFAULT_DATE_MAX,
		intensityMin: 0,
		rainMin: 0,
		lengthMin: 0,
		durationMin: 0,
		spellFilter: "all",
		climate: { oni: "all", nao: "all", ao: "all", pna: "all", mjo: "all" },
		query: "",
		mapLayer: "tracks",
		mapColour: "single",
		showRegionBoxes: true,
		crossingLongitude: 70,
		hideTracksWithWeather: true,
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
		const [catalogueBuffer, fixesBuffer, timesBuffer, routesBuffer, climateBuffer, jetBuffer] = await Promise.all([
			fetchInflated(CONFIG.catalogue),
			fetchInflated(CONFIG.fixes),
			fetchInflated(CONFIG.times),
			CONFIG.routes ? fetchInflated(CONFIG.routes) : Promise.resolve(null),
			CONFIG.climate ? fetchInflated(CONFIG.climate) : Promise.resolve(null),
			CONFIG.jet ? fetchInflated(CONFIG.jet) : Promise.resolve(null)
		]);
		DATA = JSON.parse(new TextDecoder().decode(catalogueBuffer));
		CAT = DATA.cat;
		OFF = DATA.off;
		META = DATA.meta;
		ROUTES = routesBuffer ? JSON.parse(new TextDecoder().decode(routesBuffer)) : null;
		CLIMATE = climateBuffer ? JSON.parse(new TextDecoder().decode(climateBuffer)) : null;
		JET = jetBuffer ? JSON.parse(new TextDecoder().decode(jetBuffer)) : null;

		const fixes = new Int16Array(fixesBuffer);
		if (fixes.length !== META.npts * 4) {
			throw new Error(`Fix asset contains ${fixes.length} values; expected ${META.npts * 4}.`);
		}
		PLON = fixes.subarray(0, META.npts);
		PLAT = fixes.subarray(META.npts, META.npts * 2);
		PVORT = fixes.subarray(META.npts * 2, META.npts * 3);
		PRAIN = fixes.subarray(META.npts * 3, META.npts * 4);
		PTIME = new Int32Array(timesBuffer);
		if (PTIME.length !== META.npts) {
			throw new Error(`Time asset contains ${PTIME.length} values; expected ${META.npts}.`);
		}
		await Promise.all([discoverWeatherFields(), discoverImpactArchive()]);
		installEvolutionMetrics();
		if (ROUTES && ROUTES.assignment && ROUTES.assignment.length === META.ntracks) {
			routeByTrack = Uint8Array.from(ROUTES.assignment);
			routeDefinitions = ROUTES.definitions || [];
		}
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

	async function discoverWeatherFields() {
		const base = String(CONFIG.weatherBase || "").replace(/\/$/, "");
		await Promise.all((CONFIG.optionalWeatherFields || []).map(async (field) => {
			try {
				const response = await fetch(`${base}/${field}-manifest.json`, { cache: "no-cache" });
				if (!response.ok) return;
				const manifest = await response.json();
				if (manifest.field_key !== field || manifest.active_months !== 912) return;
				availableWeatherFields.add(field);
				const option = $(`#wdWeatherLayer option[value="${field}"]`);
				if (option) { option.disabled = false; option.textContent = WEATHER_FIELDS[field].label; }
			} catch (_) {
				// Optional weather fields remain visibly marked as staging until
				// their validated archive manifest is published.
			}
		}));
	}

	async function discoverImpactArchive() {
		const base = String(CONFIG.impactBase || "").replace(/\/$/, "");
		if (!base) return;
		try {
			const response = await fetch(`${base}/impact-manifest.json`, { cache: "no-cache" });
			if (!response.ok) return;
			const manifest = await response.json();
			impactAvailableYears = new Set((manifest.years || []).map((entry) => Number(entry.year)).filter(Number.isFinite));
		} catch (_) {
			impactAvailableYears = new Set();
		}
	}

	function installEvolutionMetrics() {
		const diagnostics = [...(META.diagnostics || []), ...(JET && JET.diagnostics || [])];
		for (const descriptor of diagnostics) EVOLUTION_METRICS[descriptor.key] = descriptor;
		const groups = [
			["Core diagnostics", ["vorticity", "rain"]],
			["Trajectory", ["speed", "path", "displacement"]]
		];
		for (const descriptor of diagnostics) {
			let group = groups.find(([label]) => label === descriptor.group);
			if (!group) { group = [descriptor.group, []]; groups.push(group); }
			group[1].push(descriptor.key);
		}
		const options = groups.map(([label, keys]) => `<optgroup label="${escapeHtml(label)}">${keys.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(EVOLUTION_METRICS[key].label)}</option>`).join("")}</optgroup>`).join("");
		for (const select of [$("#wdEvolutionMetric"), $("#wdProfileMetric")]) select.innerHTML = options;
		const extremes = $("#wdExtremeMetric");
		extremes.insertAdjacentHTML("beforeend", `<optgroup label="Trajectory diagnostics"><option value="meanSpeed">Highest mean translation speed</option><option value="maxSpeed">Highest step translation speed</option><option value="displacement">Greatest displacement from genesis</option><option value="efficiency">Highest path efficiency</option><option value="gap">Largest tracker-bridged gap</option></optgroup><optgroup label="Per-fix ERA5 diagnostics">${diagnostics.map((descriptor) => `<option value="diag:${escapeHtml(descriptor.key)}">${descriptor.key === "mslp_min" ? "Lowest" : "Highest"} ${escapeHtml(descriptor.label.toLowerCase())}</option>`).join("")}</optgroup>`);
	}

	function loadDiagnostic(metric) {
		const descriptor = EVOLUTION_METRICS[metric];
		if (!descriptor || !descriptor.file) return Promise.resolve(null);
		if (diagnosticArrays.has(metric)) return Promise.resolve(diagnosticArrays.get(metric));
		if (diagnosticPromises.has(metric)) return diagnosticPromises.get(metric);
		const promise = fetchInflated(descriptor.file).then((buffer) => {
			const values = new Float32Array(buffer);
			if (values.length !== META.npts) throw new Error(`${descriptor.label} contains ${values.length} values; expected ${META.npts}.`);
			diagnosticArrays.set(metric, values);
			diagnosticErrors.delete(metric);
			return values;
		}).catch((error) => {
			diagnosticErrors.set(metric, error.message || String(error));
			throw error;
		}).finally(() => diagnosticPromises.delete(metric));
		diagnosticPromises.set(metric, promise);
		return promise;
	}

	function metricIsReady(metric, redraw) {
		const descriptor = EVOLUTION_METRICS[metric];
		if (!descriptor || !descriptor.file || diagnosticArrays.has(metric)) return true;
		if (diagnosticErrors.has(metric)) return false;
		if (!diagnosticPromises.has(metric)) loadDiagnostic(metric).then(redraw).catch(redraw);
		return false;
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
		const lysisRegionCounts = Array(LYSIS_REGIONS.length).fill(0);
		const routeCounts = Array(routeDefinitions.length).fill(0);
		for (let i = 0; i < META.ntracks; i += 1) {
			monthCounts[CAT.month[i] - 1] += 1;
			regionCounts[CAT.dom[i]] += 1;
			genesisRegionCounts[genesisRegionByTrack[i]] += 1;
			lysisRegionCounts[lysisRegionByTrack[i]] += 1;
			if (routeByTrack && routeByTrack[i] < routeCounts.length) routeCounts[routeByTrack[i]] += 1;
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
		$("#wdLysisRegionChips").innerHTML = LYSIS_REGIONS.map((region, index) =>
			`<button class="mla-chip" type="button" data-lysis-region="${index}" aria-pressed="false">${region.label}<span class="wd-footnote">${lysisRegionCounts[index].toLocaleString()}</span></button>`
		).join("");
		$("#wdRouteChips").innerHTML = routeDefinitions.map((route, index) =>
			`<button class="mla-chip" type="button" data-route="${index}" aria-pressed="false">${escapeHtml(route.label)}<span class="wd-footnote">${routeCounts[index].toLocaleString()}</span></button>`
		).join("");
		if (!routeDefinitions.length) $("#wdRouteChips").innerHTML = '<span class="mla-caution">Route asset unavailable.</span>';
		renderMetricChips();
		syncControlsFromState();
	}

	function renderMetricChips() {
		$("#wdEvolutionMetricChips").innerHTML = evolutionMetrics.map((metric, index) => `<button class="mla-chip" type="button" data-remove-evolution="${escapeHtml(metric)}" style="--wd-chip-colour:${SERIES_COLOURS[index]}">${escapeHtml(EVOLUTION_METRICS[metric].label)}</button>`).join("");
		$("#wdProfileMetricChips").innerHTML = profileMetrics.map((metric, index) => `<button class="mla-chip" type="button" data-remove-profile="${escapeHtml(metric)}" style="--wd-chip-colour:${SERIES_COLOURS[index % SERIES_COLOURS.length]}">${escapeHtml(EVOLUTION_METRICS[metric].label)}</button>`).join("");
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
		$("#wdYearBasis").addEventListener("change", (event) => {
			const oldMaximum = catalogueYearMaximum();
			const usedFullRange = state.yearMin === catalogueYearMinimum() && state.yearMax === oldMaximum;
			state.yearBasis = event.target.value === "winter" ? "winter" : "calendar";
			if (usedFullRange) {
				state.yearMin = catalogueYearMinimum();
				state.yearMax = catalogueYearMaximum();
			} else {
				state.yearMin = clamp(state.yearMin, catalogueYearMinimum(), catalogueYearMaximum());
				state.yearMax = clamp(state.yearMax, state.yearMin, catalogueYearMaximum());
			}
			syncControlsFromState();
			applyFilters();
		});
		$("#wdYearMin").addEventListener("change", (event) => {
			state.yearMin = clamp(Number(event.target.value) || catalogueYearMinimum(), catalogueYearMinimum(), state.yearMax);
			syncControlsFromState();
			applyFilters();
		});
		$("#wdYearMax").addEventListener("change", (event) => {
			state.yearMax = clamp(Number(event.target.value) || catalogueYearMaximum(), state.yearMin, catalogueYearMaximum());
			syncControlsFromState();
			applyFilters();
		});
		bindDateInput("#wdDateMin", "dateMin");
		bindDateInput("#wdDateMax", "dateMax");
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
		$("#wdLysisRegionChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-lysis-region]");
			if (!button) return;
			const region = Number(button.dataset.lysisRegion);
			state.lysisRegions.has(region) ? state.lysisRegions.delete(region) : state.lysisRegions.add(region);
			syncLysisRegionChips();
			applyFilters();
		});
		$("#wdRouteChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-route]");
			if (!button) return;
			const route = Number(button.dataset.route);
			state.routes.has(route) ? state.routes.delete(route) : state.routes.add(route);
			syncRouteChips();
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
		$("#wdQuickExport").addEventListener("click", downloadSummaries);
		$("#wdSpellFilter").addEventListener("change", (event) => { state.spellFilter = event.target.value; applyFilters(); });
		for (const [id, key] of [["#wdEnsoFilter", "oni"], ["#wdNaoFilter", "nao"], ["#wdAoFilter", "ao"], ["#wdPnaFilter", "pna"], ["#wdMjoFilter", "mjo"]]) {
			$(id).addEventListener("change", (event) => { state.climate[key] = event.target.value; applyFilters(); });
		}
		$("#wdMapTimeSearch").addEventListener("change", (event) => setMapTimeFocus(event.target.value));
		$("#wdMapTimeSearch").addEventListener("keydown", (event) => {
			if (event.key === "Enter") { event.preventDefault(); setMapTimeFocus(event.currentTarget.value); }
			if (event.key === "Escape") { event.currentTarget.value = ""; setMapTimeFocus(""); }
		});

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
		$("#wdHideTracksWeather").addEventListener("change", (event) => {
			state.hideTracksWithWeather = event.target.checked;
			drawMapData();
			scheduleUrlUpdate();
		});
		$("#wdRegionBoxes").addEventListener("change", (event) => {
			state.showRegionBoxes = event.target.checked;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdCrossingLongitude").addEventListener("change", (event) => {
			state.crossingLongitude = clamp(Number(event.target.value) || 70, -20, 145);
			event.target.value = state.crossingLongitude;
			drawMap();
			drawLifeChart();
			renderDossier();
			scheduleUrlUpdate();
		});
		$("#wdZoomOut").addEventListener("click", () => zoomMap(0.72));
		$("#wdZoomIn").addEventListener("click", () => zoomMap(1.38));
		$("#wdZoomReset").addEventListener("click", resetMapView);
		$("#wdFitSubset").addEventListener("click", fitSubset);

		$("#wdPreviousFix").addEventListener("click", () => setFocusFix(focusFix - 1));
		$("#wdNextFix").addEventListener("click", () => setFocusFix(focusFix + 1));
		$("#wdTrackFix").addEventListener("input", (event) => setFocusFix(Number(event.target.value)));
		$("#wdTrackFix").addEventListener("wheel", (event) => {
			if (selected < 0) return;
			event.preventDefault();
			setFocusFix(focusFix + (event.deltaY > 0 || event.deltaX > 0 ? 1 : -1));
		}, { passive: false });
		$("#wdRetryWeather").addEventListener("click", () => {
			weatherError = "";
			weatherMonth = "";
			weatherField = "";
			syncWeatherToFocus();
		});
		$("#wdRetryImpact").addEventListener("click", () => { if (selected >= 0) { impactErrors.delete(CAT.year[selected]); impactCache.delete(CAT.year[selected]); drawImpactFootprint(); } });
		$("#wdAddEvolutionMetric").addEventListener("click", addEvolutionMetric);
		$("#wdJetPreset").addEventListener("click", () => {
			evolutionMetrics = ["jet_axis_distance_200hpa", "jet_axis_wind_speed_200hpa"].filter((metric) => EVOLUTION_METRICS[metric]);
			if (!evolutionMetrics.length) return showToast("Jet diagnostics are not available in this deployment.");
			renderMetricChips(); drawLifeChart(); scheduleUrlUpdate();
		});
		$("#wdAddProfileMetric").addEventListener("click", addProfileMetric);
		$("#wdEvolutionMetricChips").addEventListener("click", (event) => removeChartMetric(event, "evolution"));
		$("#wdProfileMetricChips").addEventListener("click", (event) => removeChartMetric(event, "profile"));
		$("#wdVerticalMetric").addEventListener("change", () => { drawVerticalChart(); scheduleUrlUpdate(); });
		const lifeCanvas = $("#wdLifeChart");
		lifeCanvas.addEventListener("pointerdown", (event) => { lifeChartDragging = true; lifeCanvas.setPointerCapture(event.pointerId); scrubLifeChart(event); });
		lifeCanvas.addEventListener("pointermove", (event) => { if (lifeChartDragging) scrubLifeChart(event); });
		lifeCanvas.addEventListener("pointerup", (event) => { lifeChartDragging = false; if (lifeCanvas.hasPointerCapture(event.pointerId)) lifeCanvas.releasePointerCapture(event.pointerId); });
		lifeCanvas.addEventListener("pointercancel", () => { lifeChartDragging = false; });
		lifeCanvas.addEventListener("keydown", handleLifeChartKey);
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

	function addEvolutionMetric() {
		const metric = $("#wdEvolutionMetric").value;
		if (evolutionMetrics.includes(metric)) return showToast(`${EVOLUTION_METRICS[metric].label} is already shown.`);
		if (evolutionMetrics.length >= 3) return showToast("Selected-system evolution supports up to three line variables.");
		evolutionMetrics.push(metric);
		renderMetricChips();
		drawLifeChart();
		scheduleUrlUpdate();
	}

	function addProfileMetric() {
		const metric = $("#wdProfileMetric").value;
		if (profileMetrics.includes(metric)) return showToast(`${EVOLUTION_METRICS[metric].label} is already shown.`);
		if (profileMetrics.length >= 6) return showToast("Subset evolution supports up to six small multiples.");
		profileMetrics.push(metric);
		renderMetricChips();
		drawProfileChart();
		scheduleUrlUpdate();
	}

	function removeChartMetric(event, kind) {
		const attribute = kind === "evolution" ? "removeEvolution" : "removeProfile";
		const button = event.target.closest(kind === "evolution" ? "[data-remove-evolution]" : "[data-remove-profile]");
		if (!button) return;
		const metrics = kind === "evolution" ? evolutionMetrics : profileMetrics;
		if (metrics.length <= 1) return showToast("Keep at least one variable visible.");
		const next = metrics.filter((metric) => metric !== button.dataset[attribute]);
		if (kind === "evolution") evolutionMetrics = next;
		else profileMetrics = next;
		renderMetricChips();
		kind === "evolution" ? drawLifeChart() : drawProfileChart();
		scheduleUrlUpdate();
	}

	function scrubLifeChart(event) {
		if (selected < 0 || !lifeChartHit) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const x = clamp(event.clientX - rect.left, lifeChartHit.left, lifeChartHit.right);
		const fraction = (x - lifeChartHit.left) / Math.max(1, lifeChartHit.right - lifeChartHit.left);
		const targetHours = fraction * lifeChartHit.maximumElapsed;
		const points = lifeChartHit.points;
		let nearest = 0;
		for (let index = 1; index < points.length; index += 1) if (Math.abs(points[index].elapsedHours - targetHours) < Math.abs(points[nearest].elapsedHours - targetHours)) nearest = index;
		setFocusFix(nearest);
	}

	function handleLifeChartKey(event) {
		if (selected < 0 || !["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
		event.preventDefault();
		if (event.key === "Home") return setFocusFix(0);
		if (event.key === "End") return setFocusFix(OFF[selected][1] - 1);
		const direction = ["ArrowRight", "PageDown"].includes(event.key) ? 1 : -1;
		setFocusFix(focusFix + direction * (event.key.startsWith("Page") ? 8 : 1));
	}

	function scheduleFilters() {
		window.clearTimeout(filterTimer);
		filterTimer = window.setTimeout(() => applyFilters(), 90);
	}

	function bindDateInput(selector, key) {
		const input = $(selector);
		const commit = () => commitDateInput(input, key);
		input.addEventListener("change", commit);
		input.addEventListener("blur", () => {
			if (!commit()) input.value = state[key];
		});
		input.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			if (commit()) input.blur();
		});
	}

	function commitDateInput(input, key) {
		const value = input.value;
		// Native date controls temporarily expose an empty value while individual
		// day/month/year segments are being typed. Preserve that partial edit.
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const previousMinimum = state.dateMin;
		const previousMaximum = state.dateMax;
		state[key] = value;
		if (state.dateMin > state.dateMax) {
			if (key === "dateMin") state.dateMax = state.dateMin;
			else state.dateMin = state.dateMax;
		}
		if (state.dateMin === previousMinimum && state.dateMax === previousMaximum) return true;
		syncControlsFromState();
		applyFilters();
		return true;
	}

	function setMapTimeFocus(value, options = {}) {
		const text = String(value || "").trim();
		if (!text) {
			mapTimeFocus = "";
			mapTimeMatches = [];
			$("#wdMapTimeSearch").value = "";
			drawMapOverlay();
			updateMapLegend(resolvedMapLayer());
			scheduleUrlUpdate();
			return;
		}
		const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2})(?::00)?)?$/);
		if (!match || Number(match[2] || 0) > 23 || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))) {
			if (!options.silent) showToast("Use YYYY-MM-DD or YYYY-MM-DD HH:00 UTC.");
			return;
		}
		mapTimeFocus = match[2] == null ? match[1] : `${match[1]}T${String(Number(match[2])).padStart(2, "0")}`;
		$("#wdMapTimeSearch").value = mapTimeFocus.replace("T", " ");
		refreshMapTimeMatches();
		if (mapTimeMatches.length) showToast(`${mapTimeMatches.length.toLocaleString()} catalogue fix${mapTimeMatches.length === 1 ? "" : "es"} at ${mapTimeFocus.replace("T", " ")} UTC.`);
		else if (!options.silent) showToast(`No filtered systems are active at ${mapTimeFocus.replace("T", " ")} UTC.`);
		drawMapOverlay();
		updateMapLegend(resolvedMapLayer());
		scheduleUrlUpdate();
	}

	function refreshMapTimeMatches() {
		mapTimeMatches = [];
		if (!mapTimeFocus) return;
		const hourly = mapTimeFocus.includes("T");
		for (const index of filtered) {
			const [start, length] = OFF[index];
			for (let fix = 0; fix < length; fix += 1) {
				const iso = new Date((Date.parse(META.time_epoch) + PTIME[start + fix] * HOUR_MS)).toISOString();
				if ((hourly && iso.slice(0, 13) === mapTimeFocus) || (!hourly && iso.slice(0, 10) === mapTimeFocus)) mapTimeMatches.push({ index, fix });
			}
		}
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
		state.lysisRegions.clear();
		state.routes.clear();
		state.yearMin = Math.min(...CAT.year);
		state.yearMax = Math.max(...CAT.year);
		state.yearBasis = "calendar";
		state.dateMin = DEFAULT_DATE_MIN;
		state.dateMax = DEFAULT_DATE_MAX;
		state.intensityMin = 0;
		state.rainMin = 0;
		state.lengthMin = 0;
		state.durationMin = 0;
		state.spellFilter = "all";
		state.climate = { oni: "all", nao: "all", ao: "all", pna: "all", mjo: "all" };
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
		for (const input of [$("#wdYearMin"), $("#wdYearMax")]) {
			input.min = catalogueYearMinimum();
			input.max = catalogueYearMaximum();
		}
		$("#wdYearMin").value = state.yearMin;
		$("#wdYearMax").value = state.yearMax;
		$("#wdYearBasis").value = state.yearBasis;
		const dateMinInput = $("#wdDateMin");
		const dateMaxInput = $("#wdDateMax");
		if (document.activeElement !== dateMinInput) dateMinInput.value = state.dateMin;
		if (document.activeElement !== dateMaxInput) dateMaxInput.value = state.dateMax;
		$("#wdIntensityMin").value = state.intensityMin;
		$("#wdIntensityOutput").textContent = `P${state.intensityMin}+`;
		$("#wdRainMin").value = state.rainMin;
		$("#wdRainOutput").textContent = `P${state.rainMin}+`;
		$("#wdLengthMin").value = state.lengthMin;
		$("#wdDurationMin").value = state.durationMin;
		$("#wdSpellFilter").value = state.spellFilter;
		for (const [id, key] of [["#wdEnsoFilter", "oni"], ["#wdNaoFilter", "nao"], ["#wdAoFilter", "ao"], ["#wdPnaFilter", "pna"], ["#wdMjoFilter", "mjo"]]) $(id).value = state.climate[key];
		$("#wdMapLayer").value = state.mapLayer;
		$("#wdMapColour").value = state.mapColour;
		$("#wdWeatherLayer").value = state.weatherLayer;
		$("#wdHideTracksWeather").checked = state.hideTracksWithWeather;
		$("#wdRegionBoxes").checked = state.showRegionBoxes;
		$("#wdCrossingLongitude").value = state.crossingLongitude;
		$("#wdMapTimeSearch").value = mapTimeFocus;
		updateWeatherControls();
		syncMonthChips();
		syncRegionChips();
		syncGenesisRegionChips();
		syncLysisRegionChips();
		syncRouteChips();
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

	function syncLysisRegionChips() {
		$$('[data-lysis-region]', $("#wdLysisRegionChips")).forEach((button) => button.setAttribute("aria-pressed", String(state.lysisRegions.has(Number(button.dataset.lysisRegion)))));
	}

	function syncRouteChips() {
		$$('[data-route]', $("#wdRouteChips")).forEach((button) => button.setAttribute("aria-pressed", String(state.routes.has(Number(button.dataset.route)))));
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
		const useLysisRegions = state.lysisRegions.size > 0;
		const useRoutes = state.routes.size > 0;
		const query = state.query.toLowerCase();
		const dateQuery = /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : "";
		const compactQuery = query.replace(/[^a-z0-9]/g, "");
		const next = [];
		for (let i = 0; i < META.ntracks; i += 1) {
			if (!state.months.has(CAT.month[i])) continue;
			if (state.timeMode === "dates") {
				if (lysisMillis(i) < minimumActive || genesisMillis(i) > maximumActive) continue;
			} else if (systemYear(i) < state.yearMin || systemYear(i) > state.yearMax) continue;
			if (CAT.pct_int[i] < state.intensityMin || CAT.pct_pr[i] < state.rainMin) continue;
			if (CAT.len_km[i] < state.lengthMin || CAT.dur[i] < state.durationMin) continue;
			if (useRegions && !state.regions.has(CAT.dom[i])) continue;
			if (useGenesisRegions && !state.genesisRegions.has(genesisRegionByTrack[i])) continue;
			if (useLysisRegions && !state.lysisRegions.has(lysisRegionByTrack[i])) continue;
			if (useRoutes && (!routeByTrack || !state.routes.has(routeByTrack[i]))) continue;
			if (state.spellFilter === "multi" && spellSizeByTrack[i] < 2) continue;
			if (state.spellFilter === "isolated" && spellSizeByTrack[i] !== 1) continue;
			if (CLIMATE) {
				if (["oni", "nao", "ao", "pna"].some((key) => state.climate[key] !== "all" && CLIMATE.categories[key][i] !== Number(state.climate[key]))) continue;
				if (state.climate.mjo !== "all" && CLIMATE.mjo_phase[i] !== Number(state.climate.mjo)) continue;
			}
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
		refreshMapTimeMatches();
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
		if (state.lysisRegions.size) pieces.push(`${state.lysisRegions.size} lysis sector${state.lysisRegions.size === 1 ? "" : "s"}`);
		if (state.routes.size) pieces.push(`${state.routes.size} route archetype${state.routes.size === 1 ? "" : "s"}`);
		if (state.regions.size) pieces.push(`${state.regions.size} impact region${state.regions.size === 1 ? "" : "s"}`);
		if (state.spellFilter !== "all") pieces.push(state.spellFilter === "multi" ? "multi-WD spells" : "isolated WDs");
		if (state.yearBasis === "winter" && state.timeMode === "years") pieces.push("winter years");
		const regimeCount = Object.values(state.climate).filter((value) => value !== "all").length;
		if (regimeCount) pieces.push(`${regimeCount} circulation filter${regimeCount === 1 ? "" : "s"}`);
		$("#wdFilterBadge").textContent = pieces.length ? pieces.join(" · ") : describeMonths();
	}

	function describeMonths() {
		const match = Object.entries(SEASONS).find(([, values]) => sameSet(state.months, new Set(values)));
		return match ? match[0].toUpperCase() : `${state.months.size} selected months`;
	}

	function updateStats() {
		let intensity = 0;
		let rain = 0;
		let rainCount = 0;
		let duration = 0;
		for (const index of filtered) {
			intensity += CAT.pk_int[index];
			if (Number.isFinite(CAT.pk_pr[index])) { rain += CAT.pk_pr[index]; rainCount += 1; }
			duration += CAT.dur[index];
		}
		const count = filtered.length || 1;
		const cards = [
			["Systems", filtered.length.toLocaleString(), `${(filtered.length / META.ntracks * 100).toFixed(1)}% of catalogue`],
			["Mean peak ζ", filtered.length ? (intensity / count).toFixed(1) : "—", "10⁻⁵ s⁻¹ · 450–300 hPa"],
			["Mean peak precipitation", rainCount ? (rain / rainCount).toFixed(1) : "—", "mm · track-centred 24 h"],
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
			drawVerticalChart();
			drawImpactFootprint();
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
		if (state.crossingLongitude >= map.view.west && state.crossingLongitude <= map.view.east) {
			const x = projectX(state.crossingLongitude);
			context.save();
			context.setLineDash([5, 5]);
			context.strokeStyle = "rgba(40,33,25,.54)";
			context.lineWidth = 1.2;
			context.beginPath(); context.moveTo(x, 0); context.lineTo(x, map.height); context.stroke();
			context.setLineDash([]);
			context.fillStyle = "rgba(40,33,25,.72)";
			context.font = "11px effra, Arial, sans-serif";
			context.fillText(`${state.crossingLongitude}°E crossing`, x + 5, 17);
			context.restore();
		}
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
		return selected < 0 ? NaN : fixTimeMillis(selected, focusFix);
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
		$("#wdTrackVorticityKey").hidden = Boolean(definition);
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
		if (state.weatherLayer !== "none" && state.hideTracksWithWeather) return "none";
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
		if (!context) return;
		context.clearRect(0, 0, map.width, map.height);
		drawMapTimeFocus(context);
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

	function drawMapTimeFocus(context) {
		if (!mapTimeMatches.length) return;
		context.save();
		context.strokeStyle = css("--mla-turmeric", "#c3931d");
		context.fillStyle = css("--mla-card", "#fffaf0");
		context.lineWidth = 2;
		const byTrack = new Map();
		for (const match of mapTimeMatches) {
			if (!byTrack.has(match.index)) byTrack.set(match.index, []);
			byTrack.get(match.index).push(match.fix);
		}
		for (const [index, fixes] of byTrack) {
			const [start] = OFF[index];
			if (fixes.length > 1) {
				context.beginPath();
				fixes.forEach((fix, position) => {
					const point = start + fix;
					const x = projectX(PLON[point] / 100), y = projectY(PLAT[point] / 100);
					position ? context.lineTo(x, y) : context.moveTo(x, y);
				});
				context.stroke();
			}
			const markerFix = fixes[Math.floor(fixes.length / 2)];
			const point = start + markerFix;
			context.beginPath(); context.arc(projectX(PLON[point] / 100), projectY(PLAT[point] / 100), 4.5, 0, Math.PI * 2); context.fill(); context.stroke();
		}
		context.restore();
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
			const crossing = longitudeCrossing(index);
			if (crossing) {
				const cx = projectX(crossing.lon), cy = projectY(crossing.lat), radius = 5;
				context.fillStyle = css("--mla-card", "#fffaf0");
				context.strokeStyle = css("--mla-ink", "#17130f");
				context.lineWidth = 2;
				context.beginPath(); context.moveTo(cx, cy - radius); context.lineTo(cx + radius, cy); context.lineTo(cx, cy + radius); context.lineTo(cx - radius, cy); context.closePath(); context.fill(); context.stroke();
			}
		}
		context.restore();
	}

	function handleMapHover(event) {
		const timeMatch = mapTimeHit(event.clientX, event.clientY, 10);
		const index = timeMatch ? timeMatch.index : mapHitTest(event.clientX, event.clientY, 9);
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
		tip.innerHTML = `<strong>${trackName(index)}</strong><br>${timeMatch ? `${formatTrackTime(index, timeMatch.fix)}<br>` : ""}${formatGenesis(index)} · ${REGION_LONG[CAT.dom[index]]}<br>Peak ζ ${CAT.pk_int[index].toFixed(1)} ×10⁻⁵ s⁻¹ (P${Math.round(CAT.pct_int[index])}) · ${formatNumber(CAT.pk_pr[index], 1)} mm`;
		tip.style.left = `${event.clientX - rect.left}px`;
		tip.style.top = `${event.clientY - rect.top}px`;
		tip.dataset.visible = "true";
	}

	function hideMapTip() {
		$("#wdMapTip").dataset.visible = "false";
	}

	function selectMapFeature(event) {
		const touch = event.pointerType === "touch" || window.matchMedia("(pointer:coarse)").matches;
		const timeMatch = mapTimeHit(event.clientX, event.clientY, touch ? 24 : 12);
		if (timeMatch) return selectTrack(timeMatch.index, { fit: false, focusFix: timeMatch.fix });
		const index = mapHitTest(event.clientX, event.clientY, touch ? 22 : 11);
		if (index < 0) return;
		const rect = map.overlay.getBoundingClientRect();
		const nearest = nearestFix(index, event.clientX - rect.left, event.clientY - rect.top);
		selectTrack(index, { fit: false, focusFix: nearest });
	}

	function mapTimeHit(clientX, clientY, tolerance) {
		if (!mapTimeMatches.length) return null;
		const rect = map.overlay.getBoundingClientRect();
		const screenX = clientX - rect.left, screenY = clientY - rect.top;
		let best = null, bestDistance = tolerance ** 2;
		for (const match of mapTimeMatches) {
			const point = OFF[match.index][0] + match.fix;
			const distance = (projectX(PLON[point] / 100) - screenX) ** 2 + (projectY(PLAT[point] / 100) - screenY) ** 2;
			if (distance < bestDistance) { bestDistance = distance; best = match; }
		}
		return best;
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
		if (mapTimeFocus) legend.insertAdjacentHTML("beforeend", `<span class="mla-legend-item"><span class="mla-swatch" style="background:${css("--mla-turmeric", "#c3931d")}"></span>${mapTimeMatches.length.toLocaleString()} fixes at ${escapeHtml(mapTimeFocus.replace("T", " "))} UTC</span>`);
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
		drawVerticalChart();
		drawImpactFootprint();
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
		drawVerticalChart();
		drawImpactFootprint();
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
		drawVerticalChart();
		if (state.weatherLayer !== "none") scheduleWeatherSync();
		scheduleUrlUpdate();
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
			const multi = filtered.filter((index) => spellSizeByTrack[index] > 1).length;
			const winters = new Set(filtered.map(systemYear));
			dossier.innerHTML = `<span class="mla-eyebrow">Current subset</span><h3>${filtered.length.toLocaleString()} western disturbances</h3><p class="mla-dossier-sub">${winters.size.toLocaleString()} ${state.yearBasis === "winter" ? "winter" : "calendar"} years · ${multi.toLocaleString()} systems in multi-WD spells</p><div class="mla-fact-grid"><div class="mla-fact"><span>Route archetypes</span><strong>${new Set(filtered.map((index) => routeByTrack ? routeByTrack[index] : -1)).size}</strong><small>present in subset</small></div><div class="mla-fact"><span>Median lifetime</span><strong>${filtered.length ? Math.round(quantile(filtered.map((index) => CAT.dur[index]).sort((a, b) => a - b), .5)) : 0} h</strong><small>filtered systems</small></div></div><p class="mla-dossier-empty">Select a track on the map or from a table to open its dossier.</p>`;
			return;
		}
		const index = selected;
		const [start, length] = OFF[index];
		const last = start + length - 1;
		const regionValues = REGION_KEYS.map((key) => Number(CAT[key][index]) || 0);
		const maximumRegion = Math.max(1, ...regionValues);
		const crossing = longitudeCrossing(index);
		const route = routeDefinitions[routeByTrack ? routeByTrack[index] : -1];
		const neighbours = selectionNeighbours(index);
		const spellMembers = [];
		if (spellSizeByTrack[index] > 1) for (let candidate = 0; candidate < META.ntracks; candidate += 1) if (spellByTrack[candidate] === spellByTrack[index] && candidate !== index) spellMembers.push(candidate);
		const analogues = similarTracks(index, 5);
		dossier.innerHTML = `
			<div class="mla-dossier-head">
				<div><span class="mla-badge" data-tone="official">${trackName(index)}</span><h3>${formatGenesis(index)}</h3><p class="mla-dossier-sub">Catalogue ID ${CAT.id[index]} · ${state.yearBasis === "winter" ? `Winter ${systemYear(index)} · ` : ""}Genesis region: ${GENESIS_REGIONS[genesisRegionByTrack[index]].longLabel}<br>${route ? `Route: ${escapeHtml(route.label)} · ` : ""}Lysis sector: ${LYSIS_REGIONS[lysisRegionByTrack[index]].label}<br><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> Dominant precipitation: ${REGION_LONG[CAT.dom[index]]}</p></div>
				<button class="mla-btn mla-btn-icon mla-btn-small" id="wdCloseDossier" type="button" aria-label="Close dossier">×</button>
			</div>
			<div class="mla-fact-grid">
				<div class="mla-fact"><span>Peak 450–300 hPa ζ</span><strong>${CAT.pk_int[index].toFixed(1)}</strong><small>10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}</small></div>
				<div class="mla-fact"><span>Peak 24 h precipitation</span><strong>${formatNumber(CAT.pk_pr[index], 1)} mm</strong><small>${CAT.pk_pr[index] == null ? "not available" : `P${Math.round(CAT.pct_pr[index])}`}</small></div>
				<div class="mla-fact"><span>Path length</span><strong>${Math.round(CAT.len_km[index]).toLocaleString()} km</strong><small>P${Math.round(CAT.pct_len[index])}</small></div>
				<div class="mla-fact"><span>Lifetime</span><strong>${CAT.dur[index]} h</strong><small>${length} three-hourly fixes</small></div>
				<div class="mla-fact"><span>Genesis</span><strong class="wd-coordinate">${(PLAT[start] / 100).toFixed(2)}°N</strong><small>${(PLON[start] / 100).toFixed(2)}°E</small></div>
				<div class="mla-fact"><span>Lysis</span><strong class="wd-coordinate">${(PLAT[last] / 100).toFixed(2)}°N</strong><small>${(PLON[last] / 100).toFixed(2)}°E · ${formatTrackTime(index, length - 1)}</small></div>
				<div class="mla-fact"><span>${state.crossingLongitude}°E crossing</span><strong>${crossing ? new Date(crossing.timeMillis).toISOString().slice(0, 16).replace("T", " ") : "Not crossed"}</strong><small>${crossing ? `${crossing.lat.toFixed(2)}°N · interpolated` : "within published track"}</small></div>
				<div class="mla-fact"><span>WD sequence</span><strong>${spellSizeByTrack[index] > 1 ? `${spellSizeByTrack[index]}-system spell` : "Isolated"}</strong><small>same winter and impact region · ≤72 h gap</small></div>
			</div>
			<div class="mla-match-box"><h4>Peak regional 24 h precipitation</h4><div class="wd-region-list">${regionValues.map((value, region) => `<div class="wd-region-row"><span>${REGION_LABELS[region]}</span><span class="wd-region-bar"><i style="width:${value / maximumRegion * 100}%;background:${REGION_COLORS[region]}"></i></span><strong>${value.toFixed(1)} mm</strong></div>`).join("")}</div></div>
			${CLIMATE ? `<div class="mla-match-box"><h4>Climate and circulation at genesis</h4><dl><dt>ENSO · ONI</dt><dd>${climateStateLabel("oni", index)}</dd><dt>NAO</dt><dd>${climateStateLabel("nao", index)}</dd><dt>AO</dt><dd>${climateStateLabel("ao", index)}</dd><dt>PNA</dt><dd>${climateStateLabel("pna", index)}</dd><dt>MJO · RMM</dt><dd>${climateStateLabel("mjo", index)}</dd></dl></div>` : ""}
			${spellMembers.length ? `<div class="mla-match-box"><h4>Other systems in this spell</h4><div class="mla-chip-row">${spellMembers.slice(0, 8).map((member) => `<button class="mla-chip" type="button" data-select-track="${member}">${trackName(member)}</button>`).join("")}</div></div>` : ""}
			<div class="mla-match-box"><h4>Closest catalogue analogues</h4><div class="mla-chip-row">${analogues.map(([analogue, distance]) => `<button class="mla-chip" type="button" data-select-track="${analogue}" title="standardised analogue distance ${distance.toFixed(2)}">${trackName(analogue)}</button>`).join("")}</div><p class="mla-caution">Trajectory shape dominates; season, lifetime, intensity and precipitation provide smaller penalties.</p></div>
			<div class="mla-dossier-actions"><button class="mla-btn mla-btn-small" id="wdPreviousTrack" type="button" ${neighbours.previous < 0 ? "disabled" : ""}>Previous WD</button><button class="mla-btn mla-btn-small" id="wdNextTrack" type="button" ${neighbours.next < 0 ? "disabled" : ""}>Next WD</button><button class="mla-btn mla-btn-small" id="wdFitSelected" type="button">Fit track on map</button><button class="mla-btn mla-btn-small" id="wdDossierDownload" type="button">Download fixes</button></div>`;
		$("#wdCloseDossier").addEventListener("click", clearSelection);
		$("#wdFitSelected").addEventListener("click", () => fitSelectedTrack(index));
		$("#wdDossierDownload").addEventListener("click", downloadSelectedFixes);
		$("#wdPreviousTrack").addEventListener("click", () => { if (neighbours.previous >= 0) selectTrack(neighbours.previous); });
		$("#wdNextTrack").addEventListener("click", () => { if (neighbours.next >= 0) selectTrack(neighbours.next); });
		$$('[data-select-track]', dossier).forEach((button) => button.addEventListener("click", () => selectTrack(Number(button.dataset.selectTrack), { fit: false })));
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
		table.tBodies[0].innerHTML = rows.map((index) => `<tr data-index="${index}" data-selected="${index === selected}"><td><button class="mla-row-button" type="button">${trackName(index)}</button></td><td>${formatGenesis(index)}</td><td><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> ${REGION_LABELS[CAT.dom[index]]}</td><td class="mla-num">${CAT.pk_int[index].toFixed(1)} <span class="wd-footnote">P${Math.round(CAT.pct_int[index])}</span></td><td class="mla-num">${formatNumber(CAT.pk_pr[index], 1)} mm</td><td class="mla-num">${Math.round(CAT.len_km[index]).toLocaleString()} km</td><td class="mla-num">${CAT.dur[index]} h</td></tr>`).join("");
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
			lifeChartHit = null;
			return;
		}
		const unavailable = evolutionMetrics.find((metric) => !metricIsReady(metric, drawLifeChart));
		if (unavailable) {
			const descriptor = EVOLUTION_METRICS[unavailable];
			const message = diagnosticErrors.has(unavailable) ? `Could not load ${descriptor.label}.` : `Loading ${descriptor.label}…`;
			drawEmptyChart(context, width, height, message);
			$("#wdLifeReadout").textContent = diagnosticErrors.get(unavailable) || message;
			$("#wdLifeData").innerHTML = "";
			return;
		}
		const points = trackPoints(selected);
		const series = evolutionMetrics.map((metric, index) => {
			const descriptor = EVOLUTION_METRICS[metric];
			const values = points.map((point) => evolutionValue(point, metric));
			return { metric, descriptor, values, range: metricRange(values, descriptor.zeroBased), colour: SERIES_COLOURS[index] };
		});
		const rains = points.map((point) => point.rain ?? 0);
		const rightMargin = 24 + Math.max(0, series.length - 1) * 58;
		const plot = chartFrame(context, width, height, {
			left: 58,
			right: rightMargin,
			top: 25,
			bottom: 42,
			yMin: series[0].range.minimum,
			yMax: series[0].range.maximum,
			yLabel: series[0].descriptor.yLabel,
			xLabel: "Hours since genesis"
		});
		const maximumElapsed = Math.max(1, points.at(-1).elapsedHours);
		const x = (index) => plot.left + (points.length === 1 ? plot.width / 2 : points[index].elapsedHours / maximumElapsed * plot.width);
		const rainMax = Math.max(1, ...rains);
		const barWidth = Math.max(1, plot.width / points.length * 0.58);
		context.fillStyle = "rgba(57, 120, 168, .24)";
		points.forEach((point, index) => {
			if (!point.rain) return;
			const barHeight = point.rain / rainMax * plot.height * 0.70;
			context.fillRect(x(index) - barWidth / 2, plot.bottom - barHeight, barWidth, barHeight);
		});
		context.save();
		context.fillStyle = css("--mla-atlas-blue", "#3978a8");
		context.font = "11px effra, Arial, sans-serif";
		context.textAlign = "left";
		context.fillText(`24 h precipitation bars · max ${rainMax.toFixed(1)} mm`, plot.left, 16);
		context.restore();
		series.forEach((item, index) => {
			const y = (value) => plot.bottom - (value - item.range.minimum) / (item.range.maximum - item.range.minimum) * plot.height;
			drawLineSeries(context, item.values, x, y, item.colour, false, plot);
			if (index > 0) drawParasiteAxis(context, plot, item, index - 1);
		});
		context.save();
		context.fillStyle = series[0].colour;
		context.font = "10px effra, Arial, sans-serif";
		context.fillText(series[0].descriptor.shortLabel || series[0].descriptor.label, 5, 15);
		context.restore();
		const crossing = longitudeCrossing(selected);
		if (crossing) {
			const crossingX = plot.left + crossing.elapsedHours / maximumElapsed * plot.width;
			context.save(); context.strokeStyle = "rgba(40,33,25,.58)"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(crossingX, plot.top); context.lineTo(crossingX, plot.bottom); context.stroke(); context.setLineDash([]); context.fillStyle = "rgba(40,33,25,.78)"; context.font = "10px effra, Arial, sans-serif"; context.fillText(`${state.crossingLongitude}°E`, crossingX + 3, plot.top + 11); context.restore();
		}
		const markerX = x(focusFix);
		context.strokeStyle = css("--mla-indigo", "#233f78");
		context.lineWidth = 1;
		context.setLineDash([4, 4]);
		context.beginPath(); context.moveTo(markerX, plot.top); context.lineTo(markerX, plot.bottom); context.stroke();
		context.setLineDash([]);
		series.forEach((item) => {
			const value = item.values[focusFix];
			if (value == null || !Number.isFinite(value)) return;
			const markerY = plot.bottom - (value - item.range.minimum) / (item.range.maximum - item.range.minimum) * plot.height;
			context.fillStyle = item.colour; context.strokeStyle = css("--mla-card", "#fffaf0"); context.lineWidth = 1.5; context.beginPath(); context.arc(markerX, markerY, 4, 0, Math.PI * 2); context.fill(); context.stroke();
		});
		$("#wdLifeReadout").textContent = `${formatTrackTime(selected, focusFix)} · ${series.map((item) => `${item.descriptor.shortLabel || item.descriptor.label} ${formatEvolutionValue(item.values[focusFix], item.descriptor)}`).join(" · ")} · precipitation ${formatNumber(points[focusFix].rain, 2)} mm`;
		$("#wdLifeData").innerHTML = accessibleTable(
			["UTC", "Hours since genesis", "Latitude", "Longitude", "24 h precipitation (mm)", ...series.map((item) => `${item.descriptor.label} (${item.descriptor.unit.trim()})`)],
			points.map((point, index) => [formatTrackTime(selected, index), point.elapsedHours, point.lat.toFixed(2), point.lon.toFixed(2), formatNumber(point.rain, 2), ...series.map((item) => formatNumber(item.values[index], item.descriptor.decimals))])
		);
		lifeChartHit = { left: plot.left, right: plot.right, maximumElapsed, points };
	}

	function drawParasiteAxis(context, plot, item, offset) {
		const x = plot.right + 10 + offset * 56;
		context.save();
		context.strokeStyle = item.colour; context.fillStyle = item.colour; context.lineWidth = 1;
		context.font = "10px effra, Arial, sans-serif"; context.textAlign = "left"; context.textBaseline = "middle";
		context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke();
		for (let tick = 0; tick <= 4; tick += 1) {
			const y = plot.top + tick / 4 * plot.height;
			const value = item.range.maximum - (item.range.maximum - item.range.minimum) * tick / 4;
			context.beginPath(); context.moveTo(x, y); context.lineTo(x + 4, y); context.stroke(); context.fillText(formatAxis(value), x + 6, y);
		}
		context.translate(x + 43, plot.top + plot.height / 2); context.rotate(Math.PI / 2); context.textAlign = "center"; context.fillText(item.descriptor.shortLabel || item.descriptor.label, 0, 0);
		context.restore();
	}

	function drawProfileChart() {
		const container = $("#wdProfileCharts");
		container.innerHTML = profileMetrics.map((metric) => `<section class="wd-profile-panel"><h4>${escapeHtml(EVOLUTION_METRICS[metric].label)}</h4><canvas class="mla-chart" data-profile-canvas="${escapeHtml(metric)}" role="img" aria-label="Subset evolution of ${escapeHtml(EVOLUTION_METRICS[metric].label)}"></canvas></section>`).join("");
		const tables = [];
		for (const metric of profileMetrics) {
			const canvas = $(`[data-profile-canvas="${metric}"]`, container);
			const chart = prepareCanvas(canvas);
			if (!chart) continue;
			const descriptor = EVOLUTION_METRICS[metric];
			if (!filtered.length) { drawEmptyChart(chart.context, chart.width, chart.height, "No systems match the current filters."); continue; }
			if (!metricIsReady(metric, drawProfileChart)) {
				const message = diagnosticErrors.has(metric) ? `Could not load ${descriptor.label}.` : `Loading ${descriptor.label}…`;
				drawEmptyChart(chart.context, chart.width, chart.height, message);
				continue;
			}
			const summary = profileSummary(filtered, metric);
			let reference = catalogueProfileCache.get(metric);
			if (!reference) { reference = profileSummary(Array.from({ length: META.ntracks }, (_, index) => index), metric); catalogueProfileCache.set(metric, reference); }
			drawProfilePanel(chart, summary, reference, descriptor, metric);
			tables.push(`<h4>${escapeHtml(descriptor.label)}</h4>${accessibleTable(["Life fraction (%)", "Systems", "Lower quartile", "Median", "Upper quartile", "All-catalogue median"], summary.map((row, index) => [row.life, row.n, formatNumber(row.q1, descriptor.decimals), formatNumber(row.median, descriptor.decimals), formatNumber(row.q3, descriptor.decimals), formatNumber(reference[index].median, descriptor.decimals)]))}`);
		}
		$("#wdProfileReadout").textContent = `${filtered.length.toLocaleString()} systems · solid line and shading are subset median/IQR; dotted line is all ${META.ntracks.toLocaleString()} systems`;
		$("#wdProfileData").innerHTML = tables.join("");
	}

	function profileSummary(indices, metric) {
		const binCount = 21;
		const bins = Array.from({ length: binCount }, () => []);
		for (const index of indices) {
			const points = trackPoints(index);
			const length = points.length;
			const sums = Array(binCount).fill(0);
			const counts = Array(binCount).fill(0);
			for (let j = 0; j < length; j += 1) {
				const lifetime = Math.max(1, points.at(-1).elapsedHours);
				const bin = length === 1 ? 0 : Math.round(points[j].elapsedHours / lifetime * (binCount - 1));
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
		return summary;
	}

	function drawProfilePanel(chart, summary, reference, descriptor, metric) {
		const { context, width, height } = chart;
		const range = metricRange(summary.flatMap((row) => [row.q1, row.q3]).concat(reference.map((row) => row.median)), descriptor.zeroBased);
		const plot = chartFrame(context, width, height, { left: 52, right: 22, top: 18, bottom: 38, yMin: range.minimum, yMax: range.maximum, yLabel: descriptor.yLabel, xLabel: "Life fraction (%)" });
		const binCount = summary.length;
		const x = (index) => plot.left + index / (binCount - 1) * plot.width;
		const y = (value) => plot.bottom - (value - plot.yMin) / (plot.yMax - plot.yMin) * plot.height;
		context.beginPath();
		summary.forEach((row, index) => index === 0 ? context.moveTo(x(index), y(row.q3 ?? plot.yMin)) : context.lineTo(x(index), y(row.q3 ?? plot.yMin)));
		for (let index = summary.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(summary[index].q1 ?? plot.yMin));
		context.closePath();
		const colour = SERIES_COLOURS[profileMetrics.indexOf(metric) % SERIES_COLOURS.length];
		context.fillStyle = withAlpha(colour, 0.19);
		context.fill();
		context.save(); context.setLineDash([5, 4]); drawLineSeries(context, reference.map((row) => row.median), x, y, "rgba(40,33,25,.66)", false, plot); context.restore();
		drawLineSeries(context, summary.map((row) => row.median), x, y, colour, false, plot);
	}

	function drawVerticalChart() {
		const chart = prepareCanvas($("#wdVerticalChart"));
		if (!chart) return;
		const { context, width, height } = chart;
		if (selected < 0) { drawEmptyChart(context, width, height, "Select a disturbance to inspect its track-centred vertical structure."); $("#wdVerticalReadout").textContent = ""; return; }
		const definition = VERTICAL_METRICS[$("#wdVerticalMetric").value] || VERTICAL_METRICS.wind_speed;
		const unavailable = definition.keys.find((key) => !metricIsReady(key, drawVerticalChart));
		if (unavailable) { drawEmptyChart(context, width, height, diagnosticErrors.has(unavailable) ? `Could not load ${definition.label}.` : `Loading ${definition.label}…`); return; }
		const points = trackPoints(selected), [start] = OFF[selected];
		const rows = definition.keys.map((key) => points.map((_, fix) => diagnosticArrays.get(key)[start + fix]));
		const finite = rows.flat().filter(Number.isFinite).sort((a, b) => a - b);
		if (!finite.length) { drawEmptyChart(context, width, height, `${definition.label} is unavailable for this system.`); return; }
		const low = quantile(finite, .02), high = quantile(finite, .98);
		const left = 56, right = 22, top = 28, bottom = height - 38, plotWidth = width - left - right, plotHeight = bottom - top;
		const maximumElapsed = Math.max(1, points.at(-1).elapsedHours);
		for (let level = 0; level < 3; level += 1) {
			const y = top + (2 - level) / 3 * plotHeight;
			for (let fix = 0; fix < points.length; fix += 1) {
				const x1 = left + points[fix].elapsedHours / maximumElapsed * plotWidth;
				const x2 = fix + 1 < points.length ? left + points[fix + 1].elapsedHours / maximumElapsed * plotWidth : x1 + Math.max(2, plotWidth / points.length);
				context.fillStyle = verticalColour(rows[level][fix], low, high);
				context.fillRect(x1, y, Math.max(1, x2 - x1 + .5), plotHeight / 3 + .5);
			}
		}
		context.strokeStyle = "rgba(40,33,25,.34)"; context.strokeRect(left, top, plotWidth, plotHeight);
		context.fillStyle = css("--mla-muted", "#665d52"); context.font = "11px effra, Arial, sans-serif"; context.textAlign = "right"; context.textBaseline = "middle";
		[500, 700, 850].forEach((level, index) => context.fillText(`${level} hPa`, left - 7, top + (index + .5) / 3 * plotHeight));
		context.textAlign = "center"; context.textBaseline = "alphabetic"; context.fillText("Hours since genesis", left + plotWidth / 2, height - 9);
		const focusX = left + points[focusFix].elapsedHours / maximumElapsed * plotWidth;
		context.strokeStyle = css("--mla-ink", "#17130f"); context.setLineDash([4, 4]); context.beginPath(); context.moveTo(focusX, top); context.lineTo(focusX, bottom); context.stroke(); context.setLineDash([]);
		const crossing = longitudeCrossing(selected);
		if (crossing) { const crossingX = left + crossing.elapsedHours / maximumElapsed * plotWidth; context.strokeStyle = "rgba(255,250,240,.9)"; context.beginPath(); context.moveTo(crossingX, top); context.lineTo(crossingX, bottom); context.stroke(); }
		context.fillStyle = css("--mla-ink", "#17130f"); context.textAlign = "left"; context.fillText(`${definition.label} · ${formatAxis(low)}–${formatAxis(high)} ${definition.unit} (2nd–98th percentile colour range)`, left, 17);
		$("#wdVerticalReadout").textContent = `${formatTrackTime(selected, focusFix)} · ${[850, 700, 500].map((level, index) => `${level} hPa ${formatNumber(rows[index][focusFix], definition.decimals)} ${definition.unit}`).join(" · ")}`;
	}

	function verticalColour(value, low, high) {
		if (!Number.isFinite(value)) return "rgba(170,165,155,.32)";
		return interpolateStops([[247, 252, 253], [178, 226, 226], [102, 194, 164], [44, 127, 184], [84, 39, 143]], clamp((value - low) / Math.max(Number.EPSILON, high - low), 0, 1), .94);
	}

	function loadImpactYear(year) {
		if (impactCache.has(year)) return Promise.resolve(impactCache.get(year));
		if (impactPromises.has(year)) return impactPromises.get(year);
		const base = String(CONFIG.impactBase || "").replace(/\/$/, "");
		if (!base) return Promise.reject(new Error("The impact-footprint archive is not configured."));
		const promise = fetch(`${base}/${year}/${year}.u16.json`).then((response) => {
			if (!response.ok) throw new Error(`${response.status} while loading the ${year} footprint index`);
			return response.json();
		}).then(async (metadata) => {
			const buffer = await fetchInflated(`${base}/${year}/${year}.u16.gz`);
			const values = new Uint16Array(buffer);
			const expected = metadata.shape.reduce((product, value) => product * value, 1);
			if (values.length !== expected) throw new Error(`The ${year} footprint shard contains ${values.length} values; expected ${expected}.`);
			const asset = { metadata, values };
			impactCache.set(year, asset); impactErrors.delete(year);
			return asset;
		}).catch((error) => { impactErrors.set(year, error.message || String(error)); throw error; }).finally(() => impactPromises.delete(year));
		impactPromises.set(year, promise);
		return promise;
	}

	function drawImpactFootprint() {
		const chart = prepareCanvas($("#wdImpactChart"));
		if (!chart) return;
		const { context, width, height } = chart;
		if (selected < 0) { drawEmptyChart(context, width, height, "Select a disturbance to inspect its accumulated precipitation footprint."); $("#wdImpactReadout").textContent = ""; $("#wdRetryImpact").hidden = true; return; }
		const year = CAT.year[selected];
		if (!impactAvailableYears.has(year)) {
			drawEmptyChart(context, width, height, `The validated ${year} footprint shard is still staging.`);
			$("#wdImpactReadout").textContent = "Footprints are enabled only after the complete archive passes track-ID, grid-shape and checksum validation.";
			$("#wdRetryImpact").hidden = true;
			return;
		}
		if (!impactCache.has(year)) {
			const error = impactErrors.get(year);
			drawEmptyChart(context, width, height, error ? "This precipitation footprint is not available yet." : `Loading ${year} precipitation footprints…`);
			$("#wdImpactReadout").textContent = error || "The yearly footprint shard is loading.";
			$("#wdRetryImpact").hidden = !error;
			if (!error && !impactPromises.has(year)) loadImpactYear(year).then(drawImpactFootprint).catch(drawImpactFootprint);
			return;
		}
		$("#wdRetryImpact").hidden = true;
		const { metadata, values } = impactCache.get(year);
		const localTrack = metadata.track_ids.indexOf(CAT.id[selected]);
		if (localTrack < 0) { drawEmptyChart(context, width, height, "This WD is absent from its footprint shard."); return; }
		const [, rows, columns] = metadata.shape, start = localTrack * rows * columns, scale = Number(metadata.scale) || 10;
		const footprint = values.subarray(start, start + rows * columns);
		const maximum = Math.max(1, ...footprint) / scale;
		const [west, south, east, north] = metadata.bounds_west_south_east_north;
		const x = (lon) => (lon - west) / (east - west) * width, y = (lat) => (north - lat) / (north - south) * height;
		context.fillStyle = css("--mla-sea", "#e7eee7"); context.fillRect(0, 0, width, height);
		for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
			const value = footprint[row * columns + column] / scale;
			if (value <= 0) continue;
			context.fillStyle = precipitationFootprintColour(Math.sqrt(value / maximum));
			context.fillRect(column / columns * width, row / rows * height, width / columns + .5, height / rows + .5);
		}
		drawProjectedContext(context, window.WD_COAST_LINES || [], x, y, "rgba(53,70,62,.72)", 1.15);
		drawProjectedContext(context, window.WD_BORDER_LINES || [], x, y, "rgba(78,60,43,.52)", .8);
		const [trackStart, length] = OFF[selected];
		context.save(); context.strokeStyle = css("--mla-ink", "#17130f"); context.lineWidth = 2.4; context.lineJoin = "round"; context.beginPath();
		for (let fix = 0; fix < length; fix += 1) { const px = x(PLON[trackStart + fix] / 100), py = y(PLAT[trackStart + fix] / 100); fix ? context.lineTo(px, py) : context.moveTo(px, py); }
		context.stroke(); context.restore();
		context.fillStyle = "rgba(40,33,25,.82)"; context.font = "11px effra, Arial, sans-serif"; context.fillText(`Lifetime accumulation · maximum grid cell ${maximum.toFixed(1)} mm`, 12, 18);
		$("#wdImpactReadout").textContent = `${trackName(selected)} · ${formatTrackTime(selected, 0)} to ${formatTrackTime(selected, length - 1)} · 1° ERA5 grid · maximum ${maximum.toFixed(1)} mm`;
	}

	function precipitationFootprintColour(value) {
		return interpolateStops([[247, 252, 253], [204, 236, 230], [102, 194, 164], [35, 139, 69], [34, 94, 168], [84, 39, 143], [46, 0, 72]], clamp(value, 0, 1), .88);
	}

	function drawClimatology() {
		drawAnnualChart();
		drawMonthChart();
		drawRegionChart();
		drawGenesisChart();
		drawSpellChart();
	}

	function drawAnnualChart() {
		const chart = prepareCanvas($("#wdAnnualChart"));
		if (!chart) return;
		const years = [];
		for (let year = catalogueYearMinimum(); year <= catalogueYearMaximum(); year += 1) years.push(year);
		const counts = new Map(years.map((year) => [year, 0]));
		for (const index of filtered) counts.set(systemYear(index), (counts.get(systemYear(index)) || 0) + 1);
		const values = years.map((year) => counts.get(year));
		const plot = chartFrame(chart.context, chart.width, chart.height, { left: 48, right: 20, top: 22, bottom: 40, yMax: niceMaximum(values), yLabel: "Genesis systems", xLabel: state.yearBasis === "winter" ? "Winter year" : "Genesis year" });
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

	function drawSpellChart() {
		const chart = prepareCanvas($("#wdSpellChart"));
		if (!chart) return;
		const columns = 182;
		const cells = new Map();
		const multiCells = new Set();
		const systemsByWinter = new Map();
		const multiByWinter = new Map();
		for (const index of filtered) {
			const winter = winterYear(index);
			systemsByWinter.set(winter, (systemsByWinter.get(winter) || 0) + 1);
			if (spellSizeByTrack[index] > 1) multiByWinter.set(winter, (multiByWinter.get(winter) || 0) + 1);
			const startDay = Math.floor(genesisMillis(index) / 86400000) * 86400000;
			const endDay = Math.floor(lysisMillis(index) / 86400000) * 86400000;
			for (let time = startDay; time <= endDay; time += 86400000) {
				const position = winterCalendarPosition(time);
				if (!position || position.day < 0 || position.day >= columns) continue;
				const key = `${position.winter},${position.day}`;
				cells.set(key, (cells.get(key) || 0) + 1);
				if (spellSizeByTrack[index] > 1) multiCells.add(key);
			}
		}
		const years = [...systemsByWinter.keys()].sort((a, b) => a - b);
		if (!years.length) { drawEmptyChart(chart.context, chart.width, chart.height, "No November–April systems match the current filters."); $("#wdSpellData").innerHTML = ""; return; }
		const left = 48, right = 12, top = 27, bottom = chart.height - 24;
		const cellWidth = (chart.width - left - right) / columns, cellHeight = (bottom - top) / years.length;
		const maximum = Math.max(1, ...cells.values());
		for (let row = 0; row < years.length; row += 1) {
			for (let day = 0; day < columns; day += 1) {
				const key = `${years[row]},${day}`, count = cells.get(key) || 0;
				if (!count) continue;
				const x = left + day * cellWidth, y = top + row * cellHeight;
				chart.context.fillStyle = densityColour(Math.sqrt(count / maximum));
				chart.context.fillRect(x, y, Math.max(1, cellWidth + .2), Math.max(1, cellHeight + .2));
				if (multiCells.has(key) && cellWidth >= 2.2 && cellHeight >= 2.2) { chart.context.strokeStyle = "rgba(170,61,45,.82)"; chart.context.lineWidth = .8; chart.context.strokeRect(x + .3, y + .3, Math.max(.5, cellWidth - .6), Math.max(.5, cellHeight - .6)); }
			}
		}
		chart.context.strokeStyle = "rgba(40,33,25,.24)"; chart.context.strokeRect(left, top, chart.width - left - right, bottom - top);
		chart.context.fillStyle = css("--mla-muted", "#665d52"); chart.context.font = "10px effra, Arial, sans-serif"; chart.context.textAlign = "center";
		[[0,"Nov"],[30,"Dec"],[61,"Jan"],[92,"Feb"],[121,"Mar"],[152,"Apr"]].forEach(([day, label]) => chart.context.fillText(label, left + (day + 14) * cellWidth, 17));
		chart.context.textAlign = "right"; chart.context.textBaseline = "middle";
		years.forEach((year, row) => { if (row === 0 || row === years.length - 1 || year % 10 === 0) chart.context.fillText(String(year), left - 6, top + (row + .5) * cellHeight); });
		$("#wdSpellData").innerHTML = accessibleTable(["Winter year", "Filtered systems", "Systems in multi-WD spells", "Active winter days"], years.map((year) => [year, systemsByWinter.get(year), multiByWinter.get(year) || 0, [...cells.keys()].filter((key) => key.startsWith(`${year},`)).length]));
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
		if (metric.startsWith("diag:")) {
			const key = metric.slice(5), descriptor = EVOLUTION_METRICS[key];
			if (!metricIsReady(key, renderExtremes)) {
				$("#wdRecordCards").innerHTML = `<p>${diagnosticErrors.has(key) ? `Could not load ${escapeHtml(descriptor.label)}.` : `Loading ${escapeHtml(descriptor.label)}…`}</p>`;
				$("#wdExtremeTable").tHead.innerHTML = ""; $("#wdExtremeTable").tBodies[0].innerHTML = "";
				return;
			}
			diagnosticTrackSummary(key);
		}
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
		return ["southGenesis", "westGenesis", "diag:mslp_min"].includes(metric) ? -1 : 1;
	}

	function extremeValue(index, metric) {
		if (metric === "intensity") return CAT.pk_int[index];
		if (metric === "rain") return Number.isFinite(CAT.pk_pr[index]) ? CAT.pk_pr[index] : -Infinity;
		if (metric === "length") return CAT.len_km[index];
		if (metric === "duration") return CAT.dur[index];
		if (["meanSpeed", "maxSpeed", "displacement", "efficiency", "gap"].includes(metric)) return trajectorySummary(metric)[index];
		if (metric.startsWith("diag:")) {
			const value = diagnosticTrackSummary(metric.slice(5))[index];
			return Number.isFinite(value) ? value : metric === "diag:mslp_min" ? Infinity : -Infinity;
		}
		if (metric === "northGenesis" || metric === "southGenesis") return CAT.glat[index];
		return CAT.glon[index];
	}

	function extremeLabel(metric) {
		if (metric.startsWith("diag:")) { const descriptor = EVOLUTION_METRICS[metric.slice(5)]; return `${metric === "diag:mslp_min" ? "Lowest" : "Highest"} ${descriptor.label}`; }
		return ({ intensity: "Peak 450–300 hPa ζ", rain: "Peak 24 h precipitation", length: "Path length", duration: "Duration", meanSpeed: "Mean translation speed", maxSpeed: "Maximum step speed", displacement: "Maximum displacement", efficiency: "Path efficiency", gap: "Maximum bridged gap", northGenesis: "Genesis latitude", southGenesis: "Genesis latitude", eastGenesis: "Genesis longitude", westGenesis: "Genesis longitude" })[metric];
	}

	function formatExtreme(index, metric) {
		const value = extremeValue(index, metric);
		if (metric === "intensity") return `${value.toFixed(1)} ×10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}`;
		if (metric === "rain") return Number.isFinite(value) ? `${value.toFixed(1)} mm · P${Math.round(CAT.pct_pr[index])}` : "not available";
		if (metric === "length") return `${Math.round(value).toLocaleString()} km`;
		if (metric === "duration") return `${value} h`;
		if (metric === "meanSpeed" || metric === "maxSpeed") return `${value.toFixed(1)} m s⁻¹`;
		if (metric === "displacement") return `${Math.round(value).toLocaleString()} km`;
		if (metric === "efficiency") return `${(value * 100).toFixed(1)}%`;
		if (metric === "gap") return `${value.toFixed(0)} h`;
		if (metric.startsWith("diag:")) { const descriptor = EVOLUTION_METRICS[metric.slice(5)]; return formatEvolutionValue(value, descriptor); }
		if (metric === "northGenesis" || metric === "southGenesis") return `${value.toFixed(2)}°N`;
		return `${value.toFixed(2)}°E`;
	}

	function diagnosticTrackSummary(metric) {
		if (diagnosticSummaryCache.has(metric)) return diagnosticSummaryCache.get(metric);
		const source = diagnosticArrays.get(metric), output = new Float32Array(META.ntracks);
		output.fill(NaN);
		for (let index = 0; index < META.ntracks; index += 1) {
			const [start, length] = OFF[index];
			let value = metric === "mslp_min" ? Infinity : -Infinity;
			for (let fix = 0; fix < length; fix += 1) {
				const candidate = source[start + fix];
				if (!Number.isFinite(candidate)) continue;
				value = metric === "mslp_min" ? Math.min(value, candidate) : Math.max(value, candidate);
			}
			if (Number.isFinite(value)) output[index] = value;
		}
		diagnosticSummaryCache.set(metric, output);
		return output;
	}

	function trajectorySummary(metric) {
		if (trajectorySummaryCache.has(metric)) return trajectorySummaryCache.get(metric);
		const output = new Float32Array(META.ntracks);
		for (let index = 0; index < META.ntracks; index += 1) {
			const points = trackPoints(index);
			if (metric === "meanSpeed") output[index] = CAT.len_km[index] * 1000 / Math.max(1, CAT.dur[index] * 3600);
			else if (metric === "maxSpeed") output[index] = Math.max(...points.map((point) => point.speed));
			else if (metric === "displacement") output[index] = Math.max(...points.map((point) => point.displacement));
			else if (metric === "efficiency") output[index] = points.at(-1).displacement / Math.max(1, CAT.len_km[index]);
			else if (metric === "gap") { const [start, length] = OFF[index]; let gap = 0; for (let fix = 1; fix < length; fix += 1) gap = Math.max(gap, PTIME[start + fix] - PTIME[start + fix - 1]); output[index] = gap; }
		}
		trajectorySummaryCache.set(metric, output);
		return output;
	}

	function downloadSummaries() {
		const header = ["atlas_name", "track_id", "genesis_utc", "lysis_utc", "calendar_year", "winter_year", "genesis_lon_deg_e", "genesis_lat_deg_n", "genesis_region", "lysis_lon_deg_e", "lysis_lat_deg_n", "lysis_longitude_sector", "route_archetype", "spell_id", "spell_size", `first_crossing_${state.crossingLongitude}e_utc`, "fix_count", "duration_h", "path_length_km", "peak_vorticity_450_300hpa_1e-5_s-1", "vorticity_catalogue_percentile", "peak_24h_precipitation_mm", "precipitation_catalogue_percentile", "dominant_precipitation_region", "karakoram_peak_24h_mm", "hindu_kush_peak_24h_mm", "western_himalaya_peak_24h_mm", "central_himalaya_peak_24h_mm", "north_india_peak_24h_mm"];
		const rows = filtered.map((index) => {
			const [start, length] = OFF[index];
			const last = start + length - 1;
			const crossing = longitudeCrossing(index);
			return [trackName(index), CAT.id[index], isoTrackTime(index, 0), isoTrackTime(index, length - 1), CAT.year[index], winterYear(index), PLON[start] / 100, PLAT[start] / 100, GENESIS_REGIONS[genesisRegionByTrack[index]].longLabel, PLON[last] / 100, PLAT[last] / 100, LYSIS_REGIONS[lysisRegionByTrack[index]].label, routeDefinitions[routeByTrack ? routeByTrack[index] : -1]?.label || "", spellByTrack[index], spellSizeByTrack[index], crossing ? new Date(crossing.timeMillis).toISOString() : "", length, CAT.dur[index], CAT.len_km[index], CAT.pk_int[index], CAT.pct_int[index], CAT.pk_pr[index], CAT.pct_pr[index], REGION_LONG[CAT.dom[index]], ...REGION_KEYS.map((key) => CAT[key][index])];
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
						winter_year: winterYear(index), lysis_longitude_sector: LYSIS_REGIONS[lysisRegionByTrack[index]].label,
						route_archetype: routeDefinitions[routeByTrack ? routeByTrack[index] : -1]?.label || null, spell_id: spellByTrack[index], spell_size: spellSizeByTrack[index],
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
			selected_focus_utc: selected >= 0 ? isoTrackTime(selected, focusFix) : null,
			map_time_focus_utc: mapTimeFocus || null,
			selected_evolution_variables: evolutionMetrics,
			subset_evolution_variables: profileMetrics,
			vertical_structure_variable: $("#wdVerticalMetric").value,
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
		const rows = points.map((point, j) => [trackName(index), CAT.id[index], isoTrackTime(index, j), point.elapsedHours, point.lon, point.lat, point.vorticity, point.rain ?? "", point.speed, point.path, point.displacement]);
		downloadBlob(csvText(["atlas_name", "track_id", "time_utc", "hours_since_genesis", "longitude_deg_e", "latitude_deg_n", "vorticity_450_300hpa_1e-5_s-1", "precipitation_24h_mm", "translation_speed_m_s-1", "cumulative_path_km", "displacement_from_genesis_km"], rows), "text/csv;charset=utf-8", `${trackName(index).toLowerCase().replaceAll(" ", "-")}-fixes.csv`);
	}

	function serialisableFilters() {
		return {
			time_mode: state.timeMode,
			active_date_interval: state.timeMode === "dates" ? [state.dateMin, state.dateMax] : null,
			genesis_months: [...state.months].sort((a, b) => a - b),
			year_definition: state.yearBasis,
			genesis_or_winter_year: state.timeMode === "years" ? [state.yearMin, state.yearMax] : null,
			genesis_regions: [...state.genesisRegions].sort((a, b) => a - b).map((region) => GENESIS_REGIONS[region].longLabel),
			lysis_longitude_sectors: [...state.lysisRegions].sort((a, b) => a - b).map((region) => LYSIS_REGIONS[region].label),
			route_archetypes: [...state.routes].sort((a, b) => a - b).map((route) => routeDefinitions[route]?.label).filter(Boolean),
			wd_sequence: state.spellFilter,
			climate_at_genesis: { ...state.climate },
			crossing_longitude_deg_e: state.crossingLongitude,
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
		if (params.get("yearbasis") === "winter") state.yearBasis = "winter";
		if (params.has("months")) {
			const months = params.get("months").split(",").map(Number).filter((month) => month >= 1 && month <= 12);
			if (months.length) state.months = new Set(months);
		}
		if (params.has("years")) {
			const [minimum, maximum] = params.get("years").split(/[,-]/).map(Number);
			if (Number.isFinite(minimum)) state.yearMin = clamp(minimum, catalogueYearMinimum(), catalogueYearMaximum());
			if (Number.isFinite(maximum)) state.yearMax = clamp(maximum, catalogueYearMinimum(), catalogueYearMaximum());
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
		if (params.has("lysis")) state.lysisRegions = new Set(params.get("lysis").split(",").map((key) => LYSIS_REGIONS.findIndex((region) => region.key === key)).filter((region) => region >= 0));
		if (params.has("routes")) state.routes = new Set(params.get("routes").split(",").map((key) => routeDefinitions.findIndex((route) => route.key === key)).filter((route) => route >= 0));
		if (["all", "multi", "isolated"].includes(params.get("spell"))) state.spellFilter = params.get("spell");
		for (const key of ["oni", "nao", "ao", "pna", "mjo"]) if (["-9", "-1", "0", "1", "2", "3", "4", "5", "6", "7", "8"].includes(params.get(key))) state.climate[key] = params.get(key);
		if (params.has("q")) state.query = params.get("q").slice(0, 60);
		if (["auto", "density", "tracks", "genesis", "lysis", "none"].includes(params.get("layer"))) state.mapLayer = params.get("layer");
		if (["single", "intensity", "region", "year"].includes(params.get("colour"))) state.mapColour = params.get("colour");
		if (params.get("weather") === "none" || availableWeatherFields.has(params.get("weather"))) state.weatherLayer = params.get("weather");
		if (params.has("evolve")) { const metrics = params.get("evolve").split(",").filter((metric) => EVOLUTION_METRICS[metric]).slice(0, 3); if (metrics.length) evolutionMetrics = metrics; }
		if (params.has("profile")) { const metrics = params.get("profile").split(",").filter((metric) => EVOLUTION_METRICS[metric]).slice(0, 6); if (metrics.length) profileMetrics = metrics; }
		if (VERTICAL_METRICS[params.get("vertical")]) $("#wdVerticalMetric").value = params.get("vertical");
		if (params.get("tracks") === "0") state.mapLayer = "none";
		if (params.get("boxes") === "0") state.showRegionBoxes = false;
		if (params.get("weathertracks") === "1") state.hideTracksWithWeather = false;
		if (params.has("cross")) state.crossingLongitude = clamp(Number(params.get("cross")) || 70, -20, 145);
		if (params.has("at")) setMapTimeFocus(params.get("at"), { silent: true });
		if (["explore", "climatology", "extremes", "data"].includes(params.get("tab"))) activeTab = params.get("tab");
		if (params.has("selected")) selected = idToIndex.get(params.get("selected")) ?? -1;
		if (selected >= 0 && params.has("fix")) focusFix = clamp(Number(params.get("fix")) || 0, 0, OFF[selected][1] - 1);
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
		if (state.yearBasis === "winter") params.set("yearbasis", "winter");
		if (state.timeMode === "dates") params.set("dates", `${state.dateMin},${state.dateMax}`);
		else if (state.yearMin !== catalogueYearMinimum() || state.yearMax !== catalogueYearMaximum()) params.set("years", `${state.yearMin},${state.yearMax}`);
		if (state.intensityMin) params.set("ip", state.intensityMin);
		if (state.rainMin) params.set("rp", state.rainMin);
		if (state.lengthMin) params.set("length", state.lengthMin);
		if (state.durationMin) params.set("duration", state.durationMin);
		if (state.regions.size) params.set("regions", [...state.regions].sort((a, b) => a - b).join(","));
		if (state.genesisRegions.size) params.set("genesis", [...state.genesisRegions].sort((a, b) => a - b).map((region) => GENESIS_REGIONS[region].key).join(","));
		if (state.lysisRegions.size) params.set("lysis", [...state.lysisRegions].sort((a, b) => a - b).map((region) => LYSIS_REGIONS[region].key).join(","));
		if (state.routes.size) params.set("routes", [...state.routes].sort((a, b) => a - b).map((route) => routeDefinitions[route].key).join(","));
		if (state.spellFilter !== "all") params.set("spell", state.spellFilter);
		for (const key of ["oni", "nao", "ao", "pna", "mjo"]) if (state.climate[key] !== "all") params.set(key, state.climate[key]);
		if (state.query) params.set("q", state.query);
		if (state.mapLayer !== "tracks") params.set("layer", state.mapLayer);
		if (state.mapColour !== "single") params.set("colour", state.mapColour);
		if (state.weatherLayer !== "none") params.set("weather", state.weatherLayer);
		if (!state.hideTracksWithWeather) params.set("weathertracks", "1");
		if (state.crossingLongitude !== 70) params.set("cross", state.crossingLongitude);
		if (mapTimeFocus) params.set("at", mapTimeFocus);
		if (!(evolutionMetrics.length === 1 && evolutionMetrics[0] === "vorticity")) params.set("evolve", evolutionMetrics.join(","));
		if (!(profileMetrics.length === 2 && profileMetrics[0] === "vorticity" && profileMetrics[1] === "rain")) params.set("profile", profileMetrics.join(","));
		if ($("#wdVerticalMetric").value !== "wind_speed") params.set("vertical", $("#wdVerticalMetric").value);
		if (!state.showRegionBoxes) params.set("boxes", "0");
		if (activeTab !== "explore") params.set("tab", activeTab);
		if (selected >= 0) { params.set("selected", CAT.id[selected]); params.set("fix", focusFix); }
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
		lysisRegionByTrack = new Uint8Array(META.ntracks);
		spellByTrack = new Int32Array(META.ntracks);
		spellSizeByTrack = new Uint16Array(META.ntracks);
		trackShapeFeatures = new Float32Array(META.ntracks * 18);
		if (!routeByTrack) { routeByTrack = new Uint8Array(META.ntracks); routeDefinitions = [{ key: "route_1", label: "All trajectories", count: META.ntracks }]; }
		const years = new Map();
		for (let index = 0; index < META.ntracks; index += 1) {
			if (!years.has(CAT.year[index])) years.set(CAT.year[index], []);
			years.get(CAT.year[index]).push(index);
			genesisRegionByTrack[index] = classifyGenesisRegion(CAT.glon[index], CAT.glat[index]);
			const [start, length] = OFF[index], last = start + length - 1;
			const lysisLongitude = PLON[last] / 100;
			lysisRegionByTrack[index] = Math.max(0, LYSIS_REGIONS.findIndex((region) => region.test(lysisLongitude)));
			const elapsed = PTIME[last] - PTIME[start];
			for (let sample = 0; sample < 9; sample += 1) {
				const target = elapsed * sample / 8;
				let upper = 0;
				while (upper < length - 1 && PTIME[start + upper] - PTIME[start] < target) upper += 1;
				const lower = Math.max(0, upper - 1);
				const firstTime = PTIME[start + lower] - PTIME[start], secondTime = PTIME[start + upper] - PTIME[start];
				const fraction = secondTime === firstTime ? 0 : (target - firstTime) / (secondTime - firstTime);
				trackShapeFeatures[index * 18 + sample * 2] = (PLON[start + lower] + fraction * (PLON[start + upper] - PLON[start + lower])) / 100;
				trackShapeFeatures[index * 18 + sample * 2 + 1] = (PLAT[start + lower] + fraction * (PLAT[start + upper] - PLAT[start + lower])) / 100;
			}
		}
		for (const [year, indices] of years) {
			indices.sort((a, b) => genesisMillis(a) - genesisMillis(b) || CAT.id[a] - CAT.id[b]);
			indices.forEach((index, sequence) => { trackNames[index] = `WD ${year} ${String(sequence + 1).padStart(3, "0")}`; });
		}
		buildSpellAssignments();
	}

	function buildSpellAssignments() {
		const groups = new Map();
		for (let index = 0; index < META.ntracks; index += 1) {
			const key = `${winterYear(index)}:${CAT.dom[index]}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(index);
		}
		let spell = 1;
		for (const indices of groups.values()) {
			indices.sort((a, b) => genesisMillis(a) - genesisMillis(b));
			let members = [], latestLysis = -Infinity;
			const commit = () => {
				if (!members.length) return;
				for (const index of members) { spellByTrack[index] = spell; spellSizeByTrack[index] = members.length; }
				spell += 1; members = [];
			};
			for (const index of indices) {
				if (members.length && genesisMillis(index) > latestLysis + 72 * HOUR_MS) commit();
				members.push(index); latestLysis = Math.max(latestLysis, lysisMillis(index));
			}
			commit();
		}
	}

	function selectionNeighbours(index) {
		const ordered = filtered.slice().sort((a, b) => genesisMillis(a) - genesisMillis(b) || CAT.id[a] - CAT.id[b]);
		const position = ordered.indexOf(index);
		return { previous: position > 0 ? ordered[position - 1] : -1, next: position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : -1 };
	}

	function similarTracks(index, count) {
		const candidates = filtered.length > count ? filtered : Array.from({ length: META.ntracks }, (_, candidate) => candidate);
		const distances = [];
		for (const candidate of candidates) {
			if (candidate === index) continue;
			let shapeDistance = 0;
			for (let sample = 0; sample < 9; sample += 1) {
				const lonA = trackShapeFeatures[index * 18 + sample * 2], latA = trackShapeFeatures[index * 18 + sample * 2 + 1];
				const lonB = trackShapeFeatures[candidate * 18 + sample * 2], latB = trackShapeFeatures[candidate * 18 + sample * 2 + 1];
				const dx = (lonA - lonB) * Math.cos((latA + latB) * Math.PI / 360), dy = latA - latB;
				shapeDistance += (dx * dx + dy * dy) / 100;
			}
			const monthDifference = Math.min(Math.abs(CAT.month[index] - CAT.month[candidate]), 12 - Math.abs(CAT.month[index] - CAT.month[candidate]));
			const durationDifference = Math.log(Math.max(3, CAT.dur[index]) / Math.max(3, CAT.dur[candidate]));
			let distance = shapeDistance / 9 + .35 * (monthDifference / 3) ** 2 + .35 * durationDifference ** 2 + .25 * ((CAT.pct_int[index] - CAT.pct_int[candidate]) / 40) ** 2;
			if (Number.isFinite(CAT.pct_pr[index]) && Number.isFinite(CAT.pct_pr[candidate])) distance += .18 * ((CAT.pct_pr[index] - CAT.pct_pr[candidate]) / 40) ** 2;
			distances.push([candidate, Math.sqrt(distance)]);
		}
		distances.sort((a, b) => a[1] - b[1] || CAT.id[a[0]] - CAT.id[b[0]]);
		return distances.slice(0, count);
	}

	function longitudeCrossing(index) {
		const longitude = state.crossingLongitude;
		const [start, length] = OFF[index];
		for (let fix = 0; fix < length; fix += 1) {
			const firstLon = PLON[start + fix] / 100;
			if (firstLon === longitude) return { lon: longitude, lat: PLAT[start + fix] / 100, timeMillis: fixTimeMillis(index, fix), elapsedHours: PTIME[start + fix] - PTIME[start] };
			if (fix === length - 1) continue;
			const secondLon = PLON[start + fix + 1] / 100;
			if ((firstLon - longitude) * (secondLon - longitude) > 0 || firstLon === secondLon) continue;
			const fraction = (longitude - firstLon) / (secondLon - firstLon);
			const timeHours = PTIME[start + fix] + fraction * (PTIME[start + fix + 1] - PTIME[start + fix]);
			return { lon: longitude, lat: (PLAT[start + fix] + fraction * (PLAT[start + fix + 1] - PLAT[start + fix])) / 100, timeMillis: Date.parse(META.time_epoch) + timeHours * HOUR_MS, elapsedHours: timeHours - PTIME[start] };
		}
		return null;
	}

	function systemYear(index) {
		return state.yearBasis === "winter" ? winterYear(index) : CAT.year[index];
	}

	function catalogueYearMinimum() {
		return Math.min(...CAT.year);
	}

	function catalogueYearMaximum() {
		return Math.max(...CAT.year) + (state.yearBasis === "winter" && CAT.month.some((month, index) => month === 12 && CAT.year[index] === Math.max(...CAT.year)) ? 1 : 0);
	}

	function winterYear(index) {
		return CAT.year[index] + (CAT.month[index] === 12 ? 1 : 0);
	}

	function winterCalendarPosition(timeMillis) {
		const date = new Date(timeMillis), month = date.getUTCMonth() + 1, year = date.getUTCFullYear();
		if (![11, 12, 1, 2, 3, 4].includes(month)) return null;
		const winter = month >= 11 ? year + 1 : year;
		const start = Date.UTC(winter - 1, 10, 1);
		return { winter, day: Math.floor((Date.UTC(year, month - 1, date.getUTCDate()) - start) / 86400000) };
	}

	function climateStateLabel(key, index) {
		if (!CLIMATE) return "Unavailable";
		if (key === "mjo") {
			const phase = CLIMATE.mjo_phase[index], amplitude = CLIMATE.mjo_amplitude[index];
			if (phase < 0) return "Unavailable";
			return phase === 0 ? `Weak · amplitude ${formatNumber(amplitude, 2)}` : `Active phase ${phase} · amplitude ${formatNumber(amplitude, 2)}`;
		}
		const value = CLIMATE.values[key][index], category = CLIMATE.categories[key][index];
		if (value == null || category === -9) return "Unavailable";
		const labels = key === "oni" ? { "-1": "La Niña", "0": "Neutral", "1": "El Niño" } : { "-1": "Negative", "0": "Near neutral", "1": "Positive" };
		return `${labels[String(category)]} · ${Number(value).toFixed(2)}`;
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
		const genesisTime = PTIME[start];
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const lon = PLON[point] / 100;
			const lat = PLAT[point] / 100;
			const step = j ? haversineKm(points[j - 1].lon, points[j - 1].lat, lon, lat) : 0;
			const elapsedHours = PTIME[point] - genesisTime;
			const stepHours = j ? PTIME[point] - PTIME[point - 1] : CONFIG.stepHours;
			path += step;
			points.push({
				point,
				lon,
				lat,
				elapsedHours,
				vorticity: PVORT[point] / 10,
				rain: PRAIN[point] === -32768 ? null : PRAIN[point] / 100,
				speed: step * 1000 / (Math.max(CONFIG.stepHours, stepHours) * 3600),
				path,
				displacement: j ? haversineKm(points[0].lon, points[0].lat, lon, lat) : 0
			});
		}
		return points;
	}

	function evolutionValue(point, metric) {
		if (metric === "rain") return point.rain;
		if (diagnosticArrays.has(metric)) {
			const value = diagnosticArrays.get(metric)[point.point];
			return Number.isFinite(value) ? value : null;
		}
		return point[metric];
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
		return fixTimeMillis(index, 0);
	}

	function lysisMillis(index) {
		return fixTimeMillis(index, OFF[index][1] - 1);
	}

	function fixTimeMillis(index, fix) {
		return Date.parse(META.time_epoch) + PTIME[OFF[index][0] + fix] * HOUR_MS;
	}

	function genesisDate(index) {
		return new Date(genesisMillis(index)).toISOString().slice(0, 10);
	}

	function formatGenesis(index) {
		return `${String(CAT.day[index]).padStart(2, "0")} ${MONTHS[CAT.month[index] - 1]} ${CAT.year[index]} · ${String(CAT.hour[index]).padStart(2, "0")} UTC`;
	}

	function formatTrackTime(index, fix) {
		const date = new Date(fixTimeMillis(index, fix));
		return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, "0")}:00 UTC`;
	}

	function isoTrackTime(index, fix) {
		return new Date(fixTimeMillis(index, fix)).toISOString().replace(".000Z", "Z");
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
		const segments = [];
		let segment = [];
		values.forEach((value, index) => {
			if (value != null && Number.isFinite(value)) segment.push([index, value]);
			else if (segment.length) { segments.push(segment); segment = []; }
		});
		if (segment.length) segments.push(segment);
		if (fill) for (const points of segments) {
			const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
			gradient.addColorStop(0, withAlpha(colour, 0.26));
			gradient.addColorStop(1, withAlpha(colour, 0.02));
			context.beginPath();
			context.moveTo(x(points[0][0]), plot.bottom);
			for (const [index, value] of points) context.lineTo(x(index), y(value));
			context.lineTo(x(points.at(-1)[0]), plot.bottom);
			context.closePath();
			context.fillStyle = gradient;
			context.fill();
		}
		context.beginPath();
		for (const points of segments) points.forEach(([index, value], pointIndex) => pointIndex === 0 ? context.moveTo(x(index), y(value)) : context.lineTo(x(index), y(value)));
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
