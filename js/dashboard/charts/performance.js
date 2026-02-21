/* =========================================
   Performance Chart — FPGA vs CPU Race
   Dramatic horizontal bar comparison
   ========================================= */

import { createChart, dur, fmtMs, prefersReducedMotion } from '../utils.js';

const d3 = window.d3;

export function createPerformanceChart(selector, data) {
  const margin = { top: 20, right: 90, bottom: 24, left: 56 };
  const chart = createChart(selector, margin);
  if (!chart) return;

  const { g, innerWidth, innerHeight } = chart;
  const { fpga_time_ms, cpu_time_ms, speed_improvement_x } = data.performance;
  const defs = chart.svg.append('defs');

  // ---- Gradients ----
  const fpgaGrad = defs.append('linearGradient')
    .attr('id', 'perfFpgaGrad').attr('x1', 0).attr('y1', 0).attr('x2', 1).attr('y2', 0);
  fpgaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.6);
  fpgaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f59e0b').attr('stop-opacity', 1);

  const cpuGrad = defs.append('linearGradient')
    .attr('id', 'perfCpuGrad').attr('x1', 0).attr('y1', 0).attr('x2', 1).attr('y2', 0);
  cpuGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1').attr('stop-opacity', 0.3);
  cpuGrad.append('stop').attr('offset', '100%').attr('stop-color', '#6366f1').attr('stop-opacity', 0.7);

  // Glow filter
  const glow = defs.append('filter').attr('id', 'perfGlow');
  glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
  glow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

  // ---- Layout ----
  const barHeight = Math.min(36, innerHeight * 0.22);
  const gap = barHeight * 0.8;
  const totalBarsHeight = barHeight * 2 + gap;
  const startY = (innerHeight - totalBarsHeight) / 2;

  const x = d3.scaleLinear()
    .domain([0, cpu_time_ms * 1.05])
    .range([0, innerWidth]);

  // ---- Grid ----
  g.append('g').attr('class', 'dash-grid-lines')
    .selectAll('line').data(x.ticks(4)).join('line')
    .attr('x1', d => x(d)).attr('x2', d => x(d))
    .attr('y1', startY - 10).attr('y2', startY + totalBarsHeight + 10);

  // ---- X Axis ----
  g.append('g')
    .attr('class', 'dash-axis')
    .attr('transform', `translate(0,${startY + totalBarsHeight + 16})`)
    .call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(6).tickFormat(d => fmtMs(d)))
    .call(g => g.select('.domain').remove());

  // ---- Labels ----
  g.append('text')
    .attr('x', -8).attr('y', startY + barHeight / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'central')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '11px')
    .attr('font-weight', '700')
    .attr('fill', '#f59e0b')
    .text('FPGA');

  g.append('text')
    .attr('x', -8).attr('y', startY + barHeight + gap + barHeight / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'central')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '11px')
    .attr('font-weight', '700')
    .attr('fill', '#6366f1')
    .text('CPU');

  // ---- FPGA Bar (the hero — fast) ----
  // Glow shadow
  g.append('rect')
    .attr('x', 0).attr('y', startY)
    .attr('height', barHeight)
    .attr('rx', barHeight / 2)
    .attr('fill', 'rgba(245, 158, 11, 0.2)')
    .attr('filter', 'url(#perfGlow)')
    .attr('width', 0)
    .transition()
    .duration(dur(500))
    .ease(d3.easeCubicOut)
    .attr('width', x(fpga_time_ms));

  // Main bar
  const fpgaBar = g.append('rect')
    .attr('x', 0).attr('y', startY)
    .attr('height', barHeight)
    .attr('rx', barHeight / 2)
    .attr('fill', 'url(#perfFpgaGrad)')
    .attr('width', 0);

  fpgaBar.transition()
    .duration(dur(500))
    .ease(d3.easeCubicOut)
    .attr('width', x(fpga_time_ms));

  // FPGA value label
  const fpgaLabel = g.append('text')
    .attr('y', startY + barHeight / 2)
    .attr('dominant-baseline', 'central')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '12px')
    .attr('font-weight', '700')
    .attr('fill', '#f59e0b');

  if (prefersReducedMotion) {
    fpgaLabel.attr('x', x(fpga_time_ms) + 10).text(fmtMs(fpga_time_ms));
  } else {
    fpgaLabel.attr('x', 10).attr('opacity', 0)
      .transition()
      .duration(dur(500))
      .ease(d3.easeCubicOut)
      .attr('x', x(fpga_time_ms) + 10)
      .attr('opacity', 1)
      .tween('text', function () {
        const interp = d3.interpolateNumber(0, fpga_time_ms);
        return function (t) {
          this.textContent = fmtMs(Math.round(interp(t)));
        };
      });
  }

  // ---- CPU Bar (the villain — slow) ----
  const cpuY = startY + barHeight + gap;

  g.append('rect')
    .attr('x', 0).attr('y', cpuY)
    .attr('height', barHeight)
    .attr('rx', barHeight / 2)
    .attr('fill', 'url(#perfCpuGrad)')
    .attr('width', 0)
    .transition()
    .duration(dur(1800))
    .ease(d3.easeLinear) // Linear = it crawls slowly, emphasizing how much slower CPU is
    .attr('width', x(cpu_time_ms));

  // CPU value label
  const cpuLabel = g.append('text')
    .attr('y', cpuY + barHeight / 2)
    .attr('dominant-baseline', 'central')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('fill', '#6366f1');

  if (prefersReducedMotion) {
    cpuLabel.attr('x', x(cpu_time_ms) + 10).text(fmtMs(cpu_time_ms));
  } else {
    cpuLabel.attr('x', 10).attr('opacity', 0)
      .transition()
      .duration(dur(1800))
      .ease(d3.easeLinear)
      .attr('x', x(cpu_time_ms) + 10)
      .attr('opacity', 1)
      .tween('text', function () {
        const interp = d3.interpolateNumber(0, cpu_time_ms);
        return function (t) {
          this.textContent = fmtMs(Math.round(interp(t)));
        };
      });
  }

  // ---- Speedup Badge (appears after FPGA finishes) ----
  const badgeX = x(fpga_time_ms) / 2;
  const badgeY = startY + barHeight + gap / 2;

  const badge = g.append('g')
    .attr('transform', `translate(${Math.max(badgeX, 40)},${badgeY})`)
    .attr('opacity', 0);

  badge.append('rect')
    .attr('x', -32).attr('y', -12)
    .attr('width', 64).attr('height', 24)
    .attr('rx', 12)
    .attr('fill', 'rgba(245, 158, 11, 0.12)')
    .attr('stroke', 'rgba(245, 158, 11, 0.25)')
    .attr('stroke-width', 1);

  badge.append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-family', 'var(--d-font-mono)')
    .attr('font-size', '12px')
    .attr('font-weight', '800')
    .attr('fill', '#f59e0b')
    .text(`${speed_improvement_x}x`);

  if (!prefersReducedMotion) {
    badge.transition()
      .duration(dur(400))
      .delay(dur(600))
      .ease(d3.easeBackOut.overshoot(1.5))
      .attr('opacity', 1);
  } else {
    badge.attr('opacity', 1);
  }
}

export function destroyPerformanceChart(selector) {
  d3.select(selector).selectAll('svg').remove();
}
