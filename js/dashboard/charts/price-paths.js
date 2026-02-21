/* =========================================
   Price Paths Chart — Glowing multi-line
   Confidence band + mean path + draw-in animation
   ========================================= */

import { createChart, dur, prefersReducedMotion } from '../utils.js';

const d3 = window.d3;

export function createPricePathsChart(selector, data) {
  const margin = { top: 12, right: 16, bottom: 32, left: 52 };
  const chart = createChart(selector, margin);
  if (!chart) return;

  const { g, innerWidth, innerHeight } = chart;
  const paths = data.price_paths;
  const days = paths[0].length;
  const startPrice = data.start_price;

  // ---- Scales ----
  const x = d3.scaleLinear().domain([0, days - 1]).range([0, innerWidth]);

  const allPrices = paths.flat();
  const yMin = d3.min(allPrices) * 0.98;
  const yMax = d3.max(allPrices) * 1.02;
  const y = d3.scaleLinear().domain([yMin, yMax]).range([innerHeight, 0]);

  // ---- Defs: gradient + glow filter ----
  const defs = chart.svg.append('defs');

  // Confidence band gradient
  const bandGrad = defs.append('linearGradient')
    .attr('id', 'bandGrad')
    .attr('x1', 0).attr('y1', 0)
    .attr('x2', 0).attr('y2', 1);
  bandGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.08);
  bandGrad.append('stop').attr('offset', '50%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.04);
  bandGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.08);

  // Glow filter for mean path
  const glow = defs.append('filter').attr('id', 'glowMean');
  glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  glow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

  // ---- Grid lines ----
  const yTicks = y.ticks(5);
  g.append('g').attr('class', 'dash-grid-lines')
    .selectAll('line').data(yTicks).join('line')
    .attr('x1', 0).attr('x2', innerWidth)
    .attr('y1', d => y(d)).attr('y2', d => y(d));

  // ---- Axes ----
  const xAxis = d3.axisBottom(x)
    .ticks(6)
    .tickFormat(d => `${d}d`)
    .tickSize(0)
    .tickPadding(8);

  const yAxis = d3.axisLeft(y)
    .ticks(5)
    .tickFormat(d => `$${d.toFixed(0)}`)
    .tickSize(0)
    .tickPadding(8);

  g.append('g')
    .attr('class', 'dash-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .call(g => g.select('.domain').remove());

  g.append('g')
    .attr('class', 'dash-axis')
    .call(yAxis)
    .call(g => g.select('.domain').remove());

  // ---- Compute percentiles per day ----
  const stats = d3.range(days).map(dayIdx => {
    const dayPrices = paths.map(p => p[dayIdx]).sort(d3.ascending);
    return {
      p10: d3.quantile(dayPrices, 0.1),
      p90: d3.quantile(dayPrices, 0.9),
      mean: d3.mean(dayPrices),
    };
  });

  // ---- Confidence band ----
  const areaGen = d3.area()
    .x((_, i) => x(i))
    .y0(d => y(d.p10))
    .y1(d => y(d.p90))
    .curve(d3.curveMonotoneX);

  const bandPath = g.append('path')
    .datum(stats)
    .attr('d', areaGen)
    .attr('fill', 'url(#bandGrad)')
    .attr('stroke', 'none');

  if (!prefersReducedMotion) {
    bandPath.attr('opacity', 0)
      .transition().duration(dur(1000)).delay(dur(300))
      .attr('opacity', 1);
  }

  // ---- Line generator ----
  const lineGen = d3.line()
    .x((_, i) => x(i))
    .y(d => y(d))
    .curve(d3.curveMonotoneX);

  // ---- Individual paths ----
  const pathEls = g.selectAll('.sim-path')
    .data(paths)
    .join('path')
    .attr('class', 'sim-path')
    .attr('d', lineGen)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 0.7)
    .attr('stroke-opacity', 0.1);

  // Draw-in animation
  if (!prefersReducedMotion) {
    pathEls.each(function (_, i) {
      const length = this.getTotalLength();
      d3.select(this)
        .attr('stroke-dasharray', length)
        .attr('stroke-dashoffset', length)
        .transition()
        .duration(dur(1500))
        .delay(dur(i * 25))
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    });
  }

  // ---- Mean path (glowing) ----
  const meanLine = stats.map(d => d.mean);

  // Glow layer (thicker, blurred)
  g.append('path')
    .datum(meanLine)
    .attr('d', lineGen)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 4)
    .attr('stroke-opacity', 0.25)
    .attr('filter', 'url(#glowMean)');

  // Crisp layer
  const meanPath = g.append('path')
    .datum(meanLine)
    .attr('d', lineGen)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 1.8)
    .attr('stroke-opacity', 0.9);

  if (!prefersReducedMotion) {
    const meanLength = meanPath.node().getTotalLength();
    meanPath
      .attr('stroke-dasharray', meanLength)
      .attr('stroke-dashoffset', meanLength)
      .transition()
      .duration(dur(2000))
      .ease(d3.easeCubicInOut)
      .attr('stroke-dashoffset', 0);
  }

  // ---- Start price reference line ----
  g.append('line')
    .attr('x1', 0).attr('x2', innerWidth)
    .attr('y1', y(startPrice)).attr('y2', y(startPrice))
    .attr('stroke', 'rgba(255,255,255,0.12)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 6');

  g.append('text')
    .attr('x', innerWidth)
    .attr('y', y(startPrice) - 5)
    .attr('text-anchor', 'end')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '9px')
    .attr('fill', 'rgba(255,255,255,0.25)')
    .text(`S₀ = $${startPrice.toFixed(2)}`);

  // ---- Interactive Crosshair ----
  const crosshairGroup = g.append('g').style('display', 'none');

  crosshairGroup.append('line')
    .attr('class', 'crosshair-v')
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', 'rgba(255,255,255,0.15)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3 3');

  const crosshairDot = crosshairGroup.append('circle')
    .attr('r', 4)
    .attr('fill', '#f59e0b')
    .attr('stroke', '#06060c')
    .attr('stroke-width', 2);

  const crosshairGlow = crosshairGroup.append('circle')
    .attr('r', 8)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(245,158,11,0.3)')
    .attr('stroke-width', 1);

  // Tooltip element
  const container = d3.select(selector);
  let tooltip = container.select('.chart-tooltip');
  if (tooltip.empty()) {
    tooltip = container.append('div').attr('class', 'chart-tooltip');
  }

  // Overlay rect for mouse events
  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'none')
    .attr('pointer-events', 'all')
    .on('mousemove touchmove', function (event) {
      const [mx] = d3.pointer(event, this);
      const dayIdx = Math.round(x.invert(mx));
      if (dayIdx < 0 || dayIdx >= days) return;

      const meanPrice = stats[dayIdx].mean;
      const px = x(dayIdx);
      const py = y(meanPrice);

      crosshairGroup.style('display', null);
      crosshairGroup.select('.crosshair-v').attr('x1', px).attr('x2', px);
      crosshairDot.attr('cx', px).attr('cy', py);
      crosshairGlow.attr('cx', px).attr('cy', py);

      tooltip.classed('visible', true)
        .html(`<div class="tt-label">Day ${dayIdx}</div><div class="tt-val">$${meanPrice.toFixed(2)}</div>`)
        .style('left', (px + margin.left + 12) + 'px')
        .style('top', (py + margin.top - 20) + 'px');
    })
    .on('mouseleave touchend', function () {
      crosshairGroup.style('display', 'none');
      tooltip.classed('visible', false);
    });
}

export function destroyPricePathsChart(selector) {
  const container = d3.select(selector);
  container.selectAll('svg').remove();
  container.selectAll('.chart-tooltip').remove();
}
