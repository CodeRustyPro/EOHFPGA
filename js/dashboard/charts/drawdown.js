/* =========================================
   Drawdown Distribution — Gradient bar chart
   ========================================= */

import { createChart, dur, prefersReducedMotion } from '../utils.js';

const d3 = window.d3;

export function createDrawdownChart(selector, data) {
  const margin = { top: 12, right: 16, bottom: 32, left: 48 };
  const chart = createChart(selector, margin);
  if (!chart) return;

  const { g, innerWidth, innerHeight } = chart;
  const { bin_edges, counts } = data.drawdown_distribution;
  const defs = chart.svg.append('defs');

  // Color scale: green (short) → amber (medium) → red (long drawdown)
  const colorScale = d3.scaleLinear()
    .domain([0, Math.floor(bin_edges.length / 2), bin_edges.length - 1])
    .range(['#10b981', '#f59e0b', '#ef4444'])
    .interpolate(d3.interpolateHcl);

  // Create gradient for each bar
  bin_edges.forEach((_, i) => {
    const grad = defs.append('linearGradient')
      .attr('id', `ddGrad${i}`).attr('x1', 0).attr('y1', 1).attr('x2', 0).attr('y2', 0);
    const c = d3.color(colorScale(i));
    grad.append('stop').attr('offset', '0%').attr('stop-color', c.toString()).attr('stop-opacity', 0.3);
    grad.append('stop').attr('offset', '100%').attr('stop-color', c.toString()).attr('stop-opacity', 0.8);
  });

  // Glow filter
  const glow = defs.append('filter').attr('id', 'ddGlow');
  glow.append('feGaussianBlur').attr('stdDeviation', '2.5').attr('result', 'blur');
  glow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

  // ---- Scales ----
  const x = d3.scaleBand()
    .domain(bin_edges)
    .range([0, innerWidth])
    .padding(0.25);

  const y = d3.scaleLinear()
    .domain([0, d3.max(counts) * 1.15])
    .range([innerHeight, 0]);

  // ---- Grid ----
  g.append('g').attr('class', 'dash-grid-lines')
    .selectAll('line').data(y.ticks(4)).join('line')
    .attr('x1', 0).attr('x2', innerWidth)
    .attr('y1', d => y(d)).attr('y2', d => y(d));

  // ---- Axes ----
  g.append('g')
    .attr('class', 'dash-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8))
    .call(g => g.select('.domain').remove());

  g.append('g')
    .attr('class', 'dash-axis')
    .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8).tickFormat(d3.format(',')))
    .call(g => g.select('.domain').remove());

  // ---- Bars ----
  const bars = g.selectAll('.dd-bar')
    .data(counts)
    .join('rect')
    .attr('class', 'dd-bar')
    .attr('x', (_, i) => x(bin_edges[i]))
    .attr('width', x.bandwidth())
    .attr('rx', 4)
    .attr('y', innerHeight)
    .attr('height', 0)
    .attr('fill', (_, i) => `url(#ddGrad${i})`);

  bars.transition()
    .duration(dur(700))
    .delay((_, i) => dur(i * 100))
    .ease(d3.easeCubicOut)
    .attr('y', d => y(d))
    .attr('height', d => innerHeight - y(d));

  // ---- Value labels on top ----
  const labels = g.selectAll('.dd-label')
    .data(counts)
    .join('text')
    .attr('class', 'dd-label')
    .attr('x', (_, i) => x(bin_edges[i]) + x.bandwidth() / 2)
    .attr('y', d => y(d) - 8)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .attr('fill', (_, i) => colorScale(i));

  if (prefersReducedMotion) {
    labels.text(d => d.toLocaleString());
  } else {
    labels.attr('opacity', 0)
      .transition()
      .duration(dur(400))
      .delay((_, i) => dur(i * 100 + 500))
      .attr('opacity', 1)
      .tween('text', function (d) {
        const interp = d3.interpolateNumber(0, d);
        return function (t) {
          this.textContent = Math.round(interp(t)).toLocaleString();
        };
      });
  }

  // ---- Hover glow ----
  const container = d3.select(selector);
  let tooltip = container.select('.chart-tooltip');
  if (tooltip.empty()) {
    tooltip = container.append('div').attr('class', 'chart-tooltip');
  }

  bars
    .on('mouseover', function (event, d) {
      d3.select(this).attr('filter', 'url(#ddGlow)');
      const i = counts.indexOf(d);
      const pct = ((d / d3.sum(counts)) * 100).toFixed(1);
      tooltip.classed('visible', true)
        .html(`<div class="tt-label">${bin_edges[i]}</div><div class="tt-val">${d.toLocaleString()} paths (${pct}%)</div>`);
    })
    .on('mousemove', function (event) {
      const [mx, my] = d3.pointer(event, chart.svg.node());
      tooltip.style('left', (mx + 12) + 'px').style('top', (my - 12) + 'px');
    })
    .on('mouseleave', function () {
      d3.select(this).attr('filter', null);
      tooltip.classed('visible', false);
    });
}

export function destroyDrawdownChart(selector) {
  const container = d3.select(selector);
  container.selectAll('svg').remove();
  container.selectAll('.chart-tooltip').remove();
}
