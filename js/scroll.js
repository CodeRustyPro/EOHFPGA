/* =========================================
   Monte Carlo FPGA | Cinematic Scroll Engine
   Single rAF loop, compositor-only animations
   ========================================= */
;(function () {
  'use strict';

  /* ---- Feature detection ---- */
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.innerWidth < 768;
  var isTablet = window.innerWidth < 1024;

  /* ---- Shared state ---- */
  var scrollY = 0;
  var ticking = false;
  var resizeTimer = null;

  /* ---- Utility: clamp ---- */
  function clamp(min, val, max) {
    return Math.min(max, Math.max(min, val));
  }

  /* ---- Utility: easeOutCubic ---- */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ---- Utility: format number with commas ---- */
  function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* =========================================
     1. NAVBAR — IntersectionObserver glass blur
     ========================================= */
  function initNavbar() {
    var navbar = document.getElementById('navbar');
    var hero = document.getElementById('hero');
    if (!navbar || !hero) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          navbar.classList.toggle('scrolled', !entry.isIntersecting);
        });
      },
      { threshold: 0, rootMargin: '-80px 0px 0px 0px' }
    );
    observer.observe(hero);
  }

  /* =========================================
     2. SMOOTH SCROLL — anchor links with offset
     ========================================= */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = this.getAttribute('href');
        if (id === '#') return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        var offset = 80;
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });

        // Close mobile nav if open
        var navLinks = document.getElementById('navLinks');
        var hamburger = document.getElementById('navHamburger');
        if (navLinks) navLinks.classList.remove('open');
        if (hamburger) hamburger.classList.remove('active');
      });
    });
  }

  /* =========================================
     3. MOBILE NAV — hamburger toggle
     ========================================= */
  function initMobileNav() {
    var hamburger = document.getElementById('navHamburger');
    var navLinks = document.getElementById('navLinks');
    if (!hamburger || !navLinks) return;

    hamburger.addEventListener('click', function () {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!navLinks.contains(e.target) && !hamburger.contains(e.target)) {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
      }
    });
  }

  /* =========================================
     4. FADE-INS — IntersectionObserver
     ========================================= */
  function initFadeIns() {
    var elements = document.querySelectorAll('.fade-in');
    if (!elements.length) return;

    if (prefersReducedMotion) {
      elements.forEach(function (el) { el.classList.add('visible'); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    elements.forEach(function (el) { observer.observe(el); });
  }

  /* =========================================
     5. HERO PATHS — gentle live float
     ========================================= */
  var heroPathsData = null;
  var pathsAnimating = false;

  function initHeroPaths() {
    var svg = document.querySelector('.hero-paths');
    if (!svg || prefersReducedMotion) return;

    var paths = svg.querySelectorAll('path');
    if (!paths.length) return;

    heroPathsData = [];
    for (var i = 0; i < paths.length; i++) {
      heroPathsData.push({
        el: paths[i],
        amplitude: 1.5 + Math.random() * 3,
        speed: 0.2 + Math.random() * 0.3,
        offset: Math.random() * Math.PI * 2
      });
    }

    // Start floating after the draw-in animation finishes
    setTimeout(function () {
      pathsAnimating = true;
      requestAnimationFrame(animatePaths);
    }, 3000);

    // Pause when hero leaves viewport, resume when it returns
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          if (!pathsAnimating && heroPathsData) {
            pathsAnimating = true;
            requestAnimationFrame(animatePaths);
          }
        } else {
          pathsAnimating = false;
        }
      });
    });
    observer.observe(svg);
  }

  function animatePaths(timestamp) {
    if (!pathsAnimating || !heroPathsData) return;

    var t = timestamp * 0.001;
    for (var i = 0; i < heroPathsData.length; i++) {
      var p = heroPathsData[i];
      var y = Math.sin(t * p.speed + p.offset) * p.amplitude;
      p.el.style.transform = 'translateY(' + y + 'px)';
    }

    requestAnimationFrame(animatePaths);
  }

  /* =========================================
     6. HERO PARALLAX — rAF fade + translate
     ========================================= */
  var heroContent = null;
  var scrollCue = null;
  var heroHeight = 0;

  function initHeroParallax() {
    heroContent = document.querySelector('[data-hero-parallax]');
    scrollCue = document.querySelector('.scroll-cue');
    if (!heroContent) return;

    cacheHeroLayout();
  }

  function cacheHeroLayout() {
    var hero = document.getElementById('hero');
    heroHeight = hero ? hero.offsetHeight : window.innerHeight;
  }

  function updateHeroParallax() {
    if (!heroContent) return;
    if (scrollY > heroHeight) return; // early exit

    var progress = clamp(0, scrollY / heroHeight, 1);
    var opacity = 1 - progress * 1.2;
    opacity = clamp(0, opacity, 1);

    if (isMobile) {
      heroContent.style.opacity = opacity;
      heroContent.style.transform = '';
    } else {
      var translateY = scrollY * 0.5;
      heroContent.style.opacity = opacity;
      heroContent.style.transform = 'translateY(' + translateY + 'px)';
    }

    if (scrollCue) {
      var cueOpacity = 1 - progress * 3;
      scrollCue.style.opacity = clamp(0, cueOpacity, 1);
    }
  }

  /* =========================================
     6. TEXT REVEAL — word-by-word on scroll
     ========================================= */
  var textRevealData = null;

  function initTextReveal() {
    var wrap = document.querySelector('[data-text-reveal]');
    if (!wrap) return;

    var paragraph = wrap.querySelector('.text-reveal-paragraph');
    if (!paragraph) return;

    // Mobile: simple fade-in
    if (isMobile || prefersReducedMotion) {
      paragraph.classList.add('mobile-revealed');
      if (prefersReducedMotion) return;

      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            paragraph.classList.add('mobile-revealed');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.2 });
      obs.observe(paragraph);
      return;
    }

    // Split text into spans
    var text = paragraph.textContent.trim();
    var words = text.split(/\s+/);
    paragraph.innerHTML = words.map(function (w) {
      return '<span class="reveal-word">' + w + '</span>';
    }).join(' ');

    var spans = paragraph.querySelectorAll('.reveal-word');
    textRevealData = {
      wrap: wrap,
      spans: spans,
      top: 0,
      height: 0
    };

    cacheTextRevealLayout();
  }

  function cacheTextRevealLayout() {
    if (!textRevealData) return;
    var rect = textRevealData.wrap.getBoundingClientRect();
    textRevealData.top = rect.top + window.pageYOffset;
    textRevealData.height = rect.height;
  }

  function updateTextReveal() {
    if (!textRevealData) return;

    var sectionStart = textRevealData.top - window.innerHeight * 0.75;
    var sectionEnd = textRevealData.top + textRevealData.height - window.innerHeight * 0.25;

    if (scrollY < sectionStart || scrollY > sectionEnd + window.innerHeight) return;

    var totalRange = sectionEnd - sectionStart;
    var count = textRevealData.spans.length;

    for (var i = 0; i < count; i++) {
      var wordStart = sectionStart + (i / count) * totalRange;
      var wordRange = totalRange / count * 2;
      var wordProgress = clamp(0, (scrollY - wordStart) / wordRange, 1);
      var opacity = 0.15 + wordProgress * 0.85;
      textRevealData.spans[i].style.opacity = opacity;
    }
  }

  /* =========================================
     7. STICKY PIPELINE — scroll progression
     ========================================= */
  var pipelineData = null;

  function initStickyPipeline() {
    var scrollWrap = document.querySelector('[data-sticky-pipeline]');
    if (!scrollWrap || isTablet) {
      // On mobile/tablet, show all stages immediately
      if (isTablet) {
        document.querySelectorAll('.pipeline-stage').forEach(function (s) {
          s.classList.add('active');
        });
        var details = document.querySelector('.pipeline-details');
        if (details) details.classList.add('visible');
      }
      return;
    }

    if (prefersReducedMotion) {
      document.querySelectorAll('.pipeline-stage').forEach(function (s) {
        s.classList.add('active');
      });
      document.querySelectorAll('.pipeline-connector line').forEach(function (l) {
        l.style.strokeDashoffset = '0';
      });
      var det = document.querySelector('.pipeline-details');
      if (det) det.classList.add('visible');
      return;
    }

    var stages = scrollWrap.querySelectorAll('.pipeline-stage');
    var connectors = scrollWrap.querySelectorAll('.pipeline-connector line');
    var details = scrollWrap.querySelector('.pipeline-details');

    pipelineData = {
      wrap: scrollWrap,
      stages: stages,
      connectors: connectors,
      details: details,
      top: 0,
      height: 0
    };

    cachePipelineLayout();
  }

  function cachePipelineLayout() {
    if (!pipelineData) return;
    var rect = pipelineData.wrap.getBoundingClientRect();
    pipelineData.top = rect.top + window.pageYOffset;
    pipelineData.height = pipelineData.wrap.offsetHeight;
  }

  function updateStickyPipeline() {
    if (!pipelineData) return;

    var start = pipelineData.top;
    var end = pipelineData.top + pipelineData.height - window.innerHeight;

    if (scrollY < start || scrollY > end + window.innerHeight) return;

    var progress = clamp(0, (scrollY - start) / (end - start), 1);
    var stageCount = pipelineData.stages.length;

    for (var i = 0; i < stageCount; i++) {
      var stageThreshold = i / stageCount;
      if (progress >= stageThreshold) {
        pipelineData.stages[i].classList.add('active');
      } else {
        pipelineData.stages[i].classList.remove('active');
      }
    }

    // Animate connectors between stages
    for (var j = 0; j < pipelineData.connectors.length; j++) {
      var connStart = (j + 0.5) / stageCount;
      var connEnd = (j + 1) / stageCount;
      var connProgress = clamp(0, (progress - connStart) / (connEnd - connStart), 1);
      var dashOffset = 60 * (1 - connProgress);
      pipelineData.connectors[j].style.strokeDashoffset = dashOffset;
    }

    // Show detail cards at 90% progress
    if (pipelineData.details) {
      if (progress >= 0.9) {
        pipelineData.details.classList.add('visible');
      } else {
        pipelineData.details.classList.remove('visible');
      }
    }
  }

  /* =========================================
     8. BENCHMARKS — bars + counters
     ========================================= */
  function initBenchmarks() {
    // Bar animations
    var benchGroups = document.querySelectorAll('[data-benchmark]');
    if (!benchGroups.length) return;

    if (prefersReducedMotion) {
      // Show final state immediately
      document.querySelectorAll('.bench-fill').forEach(function (fill) {
        var width = parseFloat(fill.dataset.barWidth) / 100;
        fill.style.setProperty('--bar-scale', width);
        fill.classList.add('animated');
      });
      document.querySelectorAll('.bench-value').forEach(function (val) {
        var target = parseFloat(val.dataset.target);
        var suffix = val.dataset.suffix || '';
        val.textContent = formatNumber(Math.round(target)) + suffix;
      });
      document.querySelectorAll('.counter').forEach(function (c) {
        var target = parseFloat(c.dataset.target);
        var hasSep = c.hasAttribute('data-separator');
        if (target % 1 !== 0) {
          c.textContent = target.toFixed(1);
        } else {
          c.textContent = hasSep ? formatNumber(target) : target;
        }
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateBenchmarkGroup(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    benchGroups.forEach(function (g) { observer.observe(g); });
  }

  function animateBenchmarkGroup(group) {
    // Animate bar fills
    var fills = group.querySelectorAll('.bench-fill');
    fills.forEach(function (fill) {
      var width = parseFloat(fill.dataset.barWidth) / 100;
      fill.style.setProperty('--bar-scale', width);
      requestAnimationFrame(function () {
        fill.classList.add('animated');
      });
    });

    // Animate bar value counters
    var values = group.querySelectorAll('.bench-value');
    values.forEach(function (val) {
      var target = parseFloat(val.dataset.target);
      var suffix = val.dataset.suffix || '';
      animateCounter(val, 0, target, 1200, function (v) {
        return formatNumber(Math.round(v)) + suffix;
      });
    });

    // Animate summary counters
    var counters = group.querySelectorAll('.counter');
    counters.forEach(function (c) {
      var target = parseFloat(c.dataset.target);
      var hasSep = c.hasAttribute('data-separator');
      var isFloat = target % 1 !== 0;

      animateCounter(c, 0, target, 1500, function (v) {
        if (isFloat) return v.toFixed(1);
        return hasSep ? formatNumber(Math.round(v)) : Math.round(v);
      });
    });
  }

  function animateCounter(el, from, to, duration, formatter) {
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = clamp(0, elapsed / duration, 1);
      var eased = easeOutCubic(progress);
      var current = from + (to - from) * eased;
      el.textContent = formatter(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  /* =========================================
     MAIN SCROLL LOOP
     ========================================= */
  function onScroll() {
    scrollY = window.pageYOffset;
    if (!ticking) {
      requestAnimationFrame(onTick);
      ticking = true;
    }
  }

  function onTick() {
    updateHeroParallax();
    updateTextReveal();
    updateStickyPipeline();
    ticking = false;
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      isMobile = window.innerWidth < 768;
      isTablet = window.innerWidth < 1024;
      cacheHeroLayout();
      cacheTextRevealLayout();
      cachePipelineLayout();
    }, 200);
  }

  /* =========================================
     BOOT
     ========================================= */
  function init() {
    scrollY = window.pageYOffset;

    initNavbar();
    initSmoothScroll();
    initMobileNav();
    initFadeIns();
    initHeroPaths();
    initHeroParallax();
    initTextReveal();
    initStickyPipeline();
    initBenchmarks();

    // Bind scroll
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    // Initial tick
    requestAnimationFrame(onTick);
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
