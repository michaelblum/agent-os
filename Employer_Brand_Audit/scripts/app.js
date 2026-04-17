function brandAudit() {
  return {
    templateMeta,
    client,
    competitors,
    comparison,
    introContent,
    activeView: "overview",
    activeDeepDive: null,
    showDeepDiveNav: false,
    citationMap: new Map(),
    lightboxImage: null,
    allCarouselData: {},
    allCompanies: [],
    themeColorMap: {},
    sortedThemes: [],

    init() {
      if (!this.client || !this.comparison || !this.introContent) {
        document.body.innerHTML = `<div class="h-screen w-full flex items-center justify-center bg-red-100 text-red-800 p-8"><div class="text-center"><h1 class="text-4xl mb-4">Data Loading Error</h1><p class="text-xl">Check scripts/report-data.template.js.</p></div></div>`;
        return;
      }

      this.allCompanies = [this.client, ...this.competitors].filter(Boolean);
      document.title = this.templateMeta?.reportTitle || "Employer Brand Competitive Audit";
      this.buildCitationMap();
      this.buildThemeColorMap();
      this._prepareCarouselData();
      this.renderAllViews();
      this.observeHeaderResize();
      this.$nextTick(() => {
        this.initTooltips();
      });
    },

    observeHeaderResize() {
      const header = document.getElementById("main-header");
      if (!header) return;
      const updateScrollPadding = () => {
        const headerHeight = header.offsetHeight;
        document.documentElement.style.scrollPaddingTop = `${headerHeight + 16}px`;
      };
      const observer = new ResizeObserver(updateScrollPadding);
      observer.observe(header);
    },

    setViewAndScroll(view, anchor = null) {
      this.activeView = view;
      this.showDeepDiveNav = view === "deepdives";
      this.activeDeepDive = anchor ? anchor.substring(1) : null;
      this.$nextTick(() => {
        if (anchor) {
          const el = document.querySelector(anchor);
          if (el) el.scrollIntoView({ behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    },

    initTooltips() {
      if (typeof tippy !== "function" || typeof microlink !== "function") return;
      tippy(".cite", {
        allowHTML: true,
        interactive: true,
        theme: "light-border",
        placement: "bottom",
        animation: "shift-away-subtle",
        content: "Loading preview...",
        onShow(instance) {
          const url = instance.reference.href;
          const cardContainer = document.createElement("div");
          cardContainer.style.width = "400px";
          instance.setContent(cardContainer);
          microlink(cardContainer, {
            url,
            size: "large",
            media: ["image", "logo"],
          });
        },
      });
    },

    buildCitationMap() {
      const allObjs = {
        client: this.client,
        competitors: this.competitors,
        comparison: this.comparison,
      };
      const urls = new Set();
      const walk = (obj) => {
        if (!obj || typeof obj !== "object") return;
        for (const [key, value] of Object.entries(obj)) {
          if (key === "sourceURL" && value) urls.add(value);
          if (key === "sourceURLs" && Array.isArray(value)) value.forEach((url) => url && urls.add(url));
          if (value && typeof value === "object") walk(value);
        }
      };
      walk(allObjs);
      let i = 1;
      Array.from(urls)
        .sort()
        .forEach((url) => {
          this.citationMap.set(url, i++);
        });
    },

    cite(url) {
      if (!url || !this.citationMap.has(url)) return "";
      const num = this.citationMap.get(url);
      return `<a href="${url}" target="_blank" rel="noopener" class="cite" title="Source ${num}">${num}</a>`;
    },

    citeList(arr) {
      if (!arr || !arr.length) return "";
      const uniqueUrls = [...new Set(arr.filter(Boolean))].filter((url) => this.citationMap.has(url));
      if (uniqueUrls.length === 0) return "";
      const citation = (url) => this.cite(url);

      if (uniqueUrls.length <= 3) {
        return `<span class="ml-2 inline-flex items-center gap-1.5 flex-wrap">${uniqueUrls.map(citation).join("")}</span>`;
      }

      const first = citation(uniqueUrls[0]);
      const last = citation(uniqueUrls.at(-1));
      const middle = uniqueUrls.slice(1, -1).map(citation).join("");

      return `<span x-data="{open:false}" class="ml-2 inline-flex items-center gap-0.5">${first}<span class="cite-more" @click="open=!open" :title="open ? 'Hide sources' : 'Show all sources'">+</span><span x-show="open" x-transition class="inline-flex items-center gap-1.5 flex-wrap">${middle}</span>${last}</span>`;
    },

    buildThemeColorMap() {
      if (!this.comparison?.kilosMessagingMatrix) return;
      const colorMap = {
        Kinship: "#F6861F",
        Impact: "#712ACE",
        Lifestyle: "#2B8FF3",
        Opportunity: "#34A853",
        Status: "#AC4560",
      };
      this.comparison.kilosMessagingMatrix.forEach((item) => {
        if (item.theme && item.dimension && colorMap[item.dimension]) {
          this.themeColorMap[item.theme] = colorMap[item.dimension];
        }
      });
      this.sortedThemes = Object.keys(this.themeColorMap).sort((a, b) => b.length - a.length);
    },

    escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    },

    highlightThemes(text) {
      if (!text || typeof text !== "string" || !this.sortedThemes.length) return text;
      let highlightedText = text;
      this.sortedThemes.forEach((theme) => {
        const color = this.themeColorMap[theme];
        const regex = new RegExp(`\\b(${this.escapeRegExp(theme)})\\b`, "gi");
        highlightedText = highlightedText.replace(regex, `<span class="font-semibold" style="color: ${color};">$1</span>`);
      });
      return highlightedText;
    },

    resolveAssetSource(asset) {
      if (!asset) return "";
      if (typeof asset === "string") return asset;
      if (asset.localPath) return asset.localPath;
      if (asset.relativePath) return asset.relativePath;
      if (asset.path) return asset.path;
      if (asset.url) return asset.url;
      if (asset.googleDriveFileId) return `https://lh3.googleusercontent.com/d/${asset.googleDriveFileId}`;
      return "";
    },

    placeholderUrl(label = "Placeholder", width = 1200, height = 630, background = "#F5F7FA", foreground = "#334860") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${foreground}" font-family="Arial, sans-serif" font-size="${Math.max(24, Math.round(width / 18))}">${label}</text></svg>`;
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    },

    assetUrl(asset, label = "Placeholder", width = 1200, height = 630, background = "#F5F7FA", foreground = "#334860") {
      return this.resolveAssetSource(asset) || this.placeholderUrl(label, width, height, background, foreground);
    },

    applyBackground(el, asset) {
      if (!el) return;
      const src = this.resolveAssetSource(asset);
      el.style.backgroundImage = src ? `url('${src}')` : "";
    },

    _prepareCarouselData() {
      this.allCompanies.forEach((company) => {
        if (!company.companyEvidence) return;
        const companySlug = this.slug(company.companyName);
        Object.entries(company.companyEvidence).forEach(([domain, data]) => {
          const dataKey = `${companySlug}-${this.slug(domain)}`;
          this.allCarouselData[dataKey] = (data.images || []).map((image) => ({
            ...image,
            src: this.assetUrl(image, "Evidence", 1280, 720, "#E2E8F0", "#334860"),
          }));
        });
      });
    },

    getCarouselData(dataKey) {
      const data = this.allCarouselData[dataKey] || [];
      return {
        activeImage: -1,
        images: data,
        init() {
          if (data.length > 0) {
            this.activeImage = 0;
            this.$dispatch("image-changed", { image: data[0] });
          }
          this.$watch("activeImage", (value) => {
            const nextImage = data[value] || null;
            this.$dispatch("image-changed", { image: nextImage });
          });
        },
        next() {
          if (data.length > 1) this.activeImage = (this.activeImage + 1) % data.length;
        },
        prev() {
          if (data.length > 1) this.activeImage = (this.activeImage - 1 + data.length) % data.length;
        },
      };
    },

    slug(text) {
      return (text || "").toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    },

    pill(value) {
      const map = { Strong: "S", Present: "P", Weak: "W", Absent: "A" };
      return value ? `<span class="pill pill-${map[value]}">${map[value]}</span>` : `<span class="pill pill-A">–</span>`;
    },

    renderAllViews() {
      this.renderOverview();
      this.renderSummary();
      this.renderCompetition();
      this.renderDeepDives();
      this.renderSubNav();
    },

    renderOverview() {
      const view = document.getElementById("overview-view");
      const intro = this.introContent.auditPreamble;
      if (!view || !intro) return;

      this.applyBackground(view, this.templateMeta.overviewBackground);

      const focusAreasHtml = (intro.methodologyFocusAreas || []).map((area) => `<li>${area}</li>`).join("");
      const frameworkHtml = intro.frameworkIntroduction ? `<p class="text-white/80 leading-relaxed mt-6">${intro.frameworkIntroduction}</p>` : "";

      view.innerHTML = `
        <div class="relative flex-grow flex items-center">
          <div class="absolute inset-0 bg-slate-900/60"></div>
          <div class="relative container mx-auto p-8 grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
            <div class="lg:col-span-2 flex flex-col justify-center text-left text-white">
              <img src="${this.assetUrl(this.templateMeta.heroLogo, "Symphony Talent Logo", 320, 96, "#08203E", "#FFFFFF")}" alt="Symphony Talent Logo" class="h-20 mb-8 w-auto self-start -mt-4 -ml-4 object-contain">
              <h1 class="text-5xl lg:text-7xl leading-tight text-white">${this.templateMeta.reportTitle || "Employer Brand Competitive Audit"}</h1>
              <h2 class="text-2xl lg:text-3xl text-[--clr-aqua] mt-4">${this.templateMeta.reportSubtitle || ""}</h2>
            </div>
            <div class="lg:col-span-3 text-white/90 relative">
              ${this.resolveAssetSource(this.templateMeta.watermarkGraphic) ? `<img src="${this.assetUrl(this.templateMeta.watermarkGraphic, "Watermark", 640, 640, "#08203E", "#48DEDA")}" alt="" class="absolute top-1/2 left-1/2 -translate-x-[45%] -translate-y-1/2 w-full max-w-lg opacity-10 pointer-events-none" />` : ""}
              <h3 class="text-3xl mb-1 text-slate-100">${intro.title || ""}</h3>
              <div class="gradient-bar !w-24"></div>
              <p class="mb-6 text-lg text-white/80 leading-relaxed">${intro.introduction || ""}</p>
              <h4 class="text-2xl font-semibold mb-2">${intro.methodologyTitle || "Methodology"}</h4>
              <p class="text-white/80 leading-relaxed">${intro.methodology || ""}</p>
              <p class="mt-4 text-white/80 leading-relaxed">To complete this analysis, we examined publicly available content across each competitor's owned and earned channels, with particular focus on:</p>
              <ul class="list-disc list-outside mt-2 ml-2 pl-4 space-y-1 text-white/80">${focusAreasHtml}</ul>
              <p class="text-white/80 leading-relaxed mt-6">${intro.closing || ""}</p>
              ${frameworkHtml}
            </div>
          </div>
        </div>`;
    },

    renderSummary() {
      const view = document.getElementById("summary-view");
      const wrapper = document.getElementById("summary-content-wrapper");
      const summary = this.comparison.executiveSummary;
      if (!view || !wrapper || !summary) return;

      this.applyBackground(view, this.templateMeta.contentBackground);
      wrapper.innerHTML = `<div class="card max-w-4xl mx-auto"><h2 class="text-3xl text-center">Executive Summary</h2><div class="gradient-bar mx-auto !w-32"></div>${["sharedThemes", "keyDifferentiators", "whiteSpaceOpportunities"].map((key) => `<div class="mt-8"><h3 class="text-2xl font-semibold mb-2">${key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())}</h3><p class="leading-relaxed">${this.highlightThemes(summary[key] || "")}${this.citeList(summary.sourceURLs || [])}</p></div>`).join("")}</div>`;
    },

    renderCompetition() {
      const view = document.getElementById("competition-view");
      const wrapper = document.getElementById("competition-content-wrapper");
      if (!view || !wrapper) return;

      this.applyBackground(view, this.templateMeta.overviewBackground);

      const allCompanies = this.allCompanies;
      const gridHtml = `<div class="card"><h2 class="text-3xl mb-6 text-center">Competitive Landscape</h2><div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">${allCompanies.map((company) => `<a @click.prevent="setViewAndScroll('deepdives', '#${this.slug(company.companyName)}')" href="#${this.slug(company.companyName)}" class="group p-4 bg-gradient-to-br from-slate-50/20 to-slate-50/10 rounded-lg border border-white/10 hover:border-white/30 shadow-inner shadow-white/5 hover:shadow-lg hover:from-slate-50/30 transition flex justify-center items-center h-24 backdrop-blur-sm"><img src="${this.assetUrl(company.companyLogo, company.companyName || "Logo", 400, 220, "#F5F7FA", "#334860")}" title="Go to ${company.companyName} section" class="max-h-12 w-auto group-hover:scale-105 transition-transform object-contain"></a>`).join("")}</div></div>`;

      const matrix = this.comparison.kilosMessagingMatrix || [];
      if (matrix.length === 0) {
        wrapper.innerHTML = `${gridHtml}<div id="kilos-matrix" class="card"><h2 class="text-3xl mb-4 text-center">KILOS Messaging Matrix</h2><div class="gradient-bar mx-auto !w-32"></div><p class="text-center text-slate-600">Add rows in <code>scripts/report-data.template.js</code> to populate the matrix.</p></div>`;
        return;
      }

      const dims = ["Kinship", "Impact", "Lifestyle", "Opportunity", "Status"];
      const colorCls = { Kinship: "dim-Kinship", Impact: "dim-Impact", Lifestyle: "dim-Lifestyle", Opportunity: "dim-Opportunity", Status: "dim-Status" };
      const grouped = {};
      matrix.forEach((row) => {
        (grouped[row.dimension] ??= []).push(row);
      });

      const header = allCompanies.map((company) => `<th class="text-center logo-header p-1"><a @click.prevent="setViewAndScroll('deepdives', '#${this.slug(company.companyName)}')" href="#${this.slug(company.companyName)}"><img src="${this.assetUrl(company.companyLogo, company.companyName || "Logo", 400, 220, "#F5F7FA", "#334860")}" alt="${company.companyName}" title="Go to ${company.companyName} section"></a></th>`).join("");
      let rows = "";
      dims.forEach((dimension) => {
        if (!grouped[dimension]) return;
        const dimensionColor = this.themeColorMap[grouped[dimension][0].theme] || "#334860";
        grouped[dimension].forEach((row, index) => {
          rows += `<tr class="border-b border-slate-100">${index === 0 ? `<td class="vbar ${colorCls[dimension]}" rowspan="${grouped[dimension].length}">${dimension}</td>` : ""}<td class="p-1 font-semibold" style="color: ${dimensionColor};">${row.theme}</td>${allCompanies.map((company) => `<td class="p-1 text-center">${this.pill(row.companyScores?.[company.companyName])}</td>`).join("")}</tr>`;
        });
      });

      const kilosKey = `<div class="flex items-center justify-center gap-x-4 gap-y-2 flex-wrap text-xs p-2 rounded-md bg-slate-50 border border-slate-200"><span class="font-bold">Key:</span><div class="flex items-center gap-1.5"><span>Strong</span><span class="pill pill-S">S</span></div><div class="flex items-center gap-1.5"><span>Present</span><span class="pill pill-P">P</span></div><div class="flex items-center gap-1.5"><span>Weak</span><span class="pill pill-W">W</span></div><div class="flex items-center gap-1.5"><span>Absent</span><span class="pill pill-A">A</span></div></div>`;
      const kilosHtml = `<div id="kilos-matrix" class="card"><div class="flex flex-col items-center gap-4 mb-6"><div class="text-center"><h2 class="text-3xl">KILOS Messaging Matrix</h2><div class="gradient-bar mx-auto !mb-0"></div></div>${kilosKey}</div><div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead class="bg-slate-50"><tr><th class="w-7 p-1"></th><th class="text-left p-1">Theme</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></div>`;

      wrapper.innerHTML = gridHtml + kilosHtml;
    },

    renderSubNav() {
      const container = document.getElementById("sub-nav-container");
      if (!container) return;
      container.innerHTML = `<div class="container mx-auto px-4 md:px-8 py-2 flex items-center space-x-6 overflow-x-auto"><span class="font-bold text-sm text-slate-400 whitespace-nowrap">DEEP DIVES:</span><div class="flex items-center space-x-4">${this.allCompanies.map((company) => `<a @click.prevent="setViewAndScroll('deepdives', '#${this.slug(company.companyName)}')" href="#${this.slug(company.companyName)}" class="block p-1 hover:bg-slate-700 rounded-md transition" :class="{'bg-slate-700': activeDeepDive === '${this.slug(company.companyName)}'}"><img src="${this.assetUrl(company.companyLogo, company.companyName || "Logo", 400, 220, "#F5F7FA", "#334860")}" alt="${company.companyName}" class="h-7 object-contain"></a>`).join("")}</div></div>`;
    },

    renderDeepDives() {
      const view = document.getElementById("deepdives-view");
      const wrapper = document.getElementById("deepdives-content-wrapper");
      if (!view || !wrapper) return;

      this.applyBackground(view, this.templateMeta.contentBackground);
      wrapper.innerHTML = this.allCompanies.map((company) => this._renderSingleDeepDive(company)).join("");
    },

    _renderSingleDeepDive(company) {
      const { companyName, companyLogo, analysis, companyEvidence } = company;
      const companySlug = this.slug(companyName);
      const valueProp = analysis?.scientificTalentValueProposition;
      const valuePropHtml = valueProp ? `<div class="mb-8"><h3 class="text-2xl mb-4">Scientific Talent Value Proposition</h3><div class="gradient-bar"></div><div class="pl-4 border-l-4 border-[--clr-orange]"><h4 class="text-xl font-bold">${this.highlightThemes(valueProp.primaryHeadline?.text || "")} ${this.citeList([valueProp.primaryHeadline?.sourceURL])}</h4>${valueProp.keyPillarStatements?.length ? `<ul class="list-disc list-outside mt-2 ml-2 pl-4 space-y-2">${valueProp.keyPillarStatements.map((pillar) => `<li>${this.highlightThemes(pillar.statement || "")} ${this.citeList([pillar.sourceURL])}</li>`).join("")}</ul>` : ""}<p>${this.highlightThemes(valueProp.summary || "")}${this.citeList(valueProp.sourceURLs || [])}</p></div></div>` : "";
      const kilosAnalysisHtml = analysis?.kilosFrameworkAnalysis ? `<div class="mb-8" x-data="{ openKilos: '' }"><h3 class="text-2xl mb-4">KILOS Framework Analysis</h3><div class="gradient-bar"></div><div class="space-y-2">${Object.entries(analysis.kilosFrameworkAnalysis).map(([dimension, data]) => data.presence ? `<div><button @click="openKilos = openKilos === '${dimension}' ? '' : '${dimension}'" class="w-full text-left flex justify-between items-center p-3 bg-slate-100 hover:bg-slate-200 rounded-md transition"><span class="font-semibold text-lg text-[--clr-slate]">${dimension}</span><ion-icon name="chevron-down-outline" class="transition-transform text-xl" :class="openKilos === '${dimension}' && 'rotate-180'"></ion-icon></button><div x-cloak x-show="openKilos === '${dimension}'" x-transition class="p-4 border border-t-0 border-slate-200 rounded-b-md"><p class="mb-4">${this.highlightThemes(data.summary || "")}${this.citeList(data.sourceURLs || [])}</p>${data.supportingEvidence?.length ? `<h5 class="font-semibold mt-4 mb-2 text-slate-600">Supporting Evidence:</h5><ul class="space-y-3">${data.supportingEvidence.map((evidence) => `<li class="p-3 bg-slate-50 rounded"><blockquote class="italic text-slate-700 border-l-4 border-slate-300 pl-3">"${this.highlightThemes(evidence.evidenceText || "")}"</blockquote><span class="text-right text-sm mt-1 text-slate-500 block">${this.highlightThemes(evidence.theme || "")} ${this.citeList([evidence.sourceURL])}</span></li>`).join("")}</ul>` : ""}</div></div>` : "").join("")}</div></div>` : "";
      const domains = Object.keys(companyEvidence || {});
      const carouselHtml = domains.length > 0 ? `<div class="card h-full" x-data="{ activeTab: '${domains[0]}', currentImage: null }" @image-changed.window="if ('${companySlug}' === activeDeepDive) { currentImage = $event.detail.image }"><h3 class="text-2xl mb-4">Evidence Gallery</h3><div class="border-b border-slate-200 mb-4"><nav class="-mb-px flex space-x-4 overflow-x-auto">${Object.entries(companyEvidence).map(([domain, data]) => `<button @click="activeTab = '${domain}'; currentImage = null" :class="{ 'border-[--clr-purple] text-[--clr-purple]': activeTab === '${domain}', 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300': activeTab !== '${domain}' }" class="whitespace-nowrap py-2 px-1 border-b-2 font-semibold text-sm transition-colors duration-200">${data.sourceDomain}</button>`).join("")}</nav></div><div class="relative">${Object.entries(companyEvidence).map(([domain]) => { const dataKey = `${companySlug}-${this.slug(domain)}`; return `<div x-cloak x-show="activeTab === '${domain}'" x-data="getCarouselData('${dataKey}')" :init="() => { if (activeTab === '${domain}') { init() } }"><template x-if="activeImage > -1"><div><div class="relative w-full h-80 bg-slate-200 rounded-md overflow-hidden flex items-center justify-center"><img :src="images[activeImage].src" class="w-full h-full object-contain" :alt="images[activeImage].description"><div @click="lightboxImage = images[activeImage].src" class="absolute inset-0 flex items-center justify-between px-2 z-20 cursor-zoom-in" title="Click to enlarge"><button @click.stop="prev()" class="bg-black/40 text-white rounded-full h-8 w-8 flex items-center justify-center hover:bg-black/60 transition cursor-pointer"><ion-icon name="chevron-back-outline"></ion-icon></button><button @click.stop="next()" class="bg-black/40 text-white rounded-full h-8 w-8 flex items-center justify-center hover:bg-black/60 transition cursor-pointer"><ion-icon name="chevron-forward-outline"></ion-icon></button></div></div><div class="mt-2 text-center h-8"><p class="text-sm text-slate-600" x-text="images[activeImage].description"></p></div></div></template><template x-if="activeImage === -1"><p class="text-center text-slate-500 py-10">No images for this domain.</p></template></div>`; }).join("")}<template x-if="currentImage && currentImage.sourceURL"><div x-html="cite(currentImage.sourceURL)" class="absolute bottom-14 right-6 z-30"></div></template></div></div>` : `<div class="card"><h3 class="text-2xl">No Visual Evidence Provided</h3><p class="mt-3 text-slate-600">Add evidence blocks in <code>scripts/report-data.template.js</code> when ready.</p></div>`;
      return `<section id="${companySlug}" class="card"><div class="flex items-center gap-4 mb-8"><img src="${this.assetUrl(companyLogo, companyName || "Logo", 400, 220, "#F5F7FA", "#334860")}" class="h-16 object-contain" alt="${companyName} Logo"><h2 class="text-3xl">${companyName}</h2></div><div class="grid grid-cols-1 lg:grid-cols-2 gap-8"><div class="analysis-column">${valuePropHtml}${kilosAnalysisHtml}</div><div class="evidence-column">${carouselHtml}</div></div></section>`;
    },
  };
}
