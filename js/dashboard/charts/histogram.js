/* =========================================
   Histogram Chart — FPGA vs CPU distribution
   Gradient bars + density curve overlay
   ========================================= */

import { createChart, dur, prefersReducedMotion } from '../utils.js';

const d3 = window.d3;

export function createHistogramChart(selector, data) {
  const margin = { top: 12, right: 16, bottom: 36, left: 48 };
  const chart = createChart(selector, margin);
  if (!chart) return;

  const { g, innerWidth, innerHeight } = chart;
  const { bin_edges, fpga_counts, cpu_counts } = data.histogram_data;
  const startPrice = data.start_price;
  const binCount = fpga_counts.length;

  // ---- Defs: gradients ----
  const defs = chart.svg.append('defs');

  // FPGA bar gradient
  const fpgaGrad = defs.append('linearGradient')
    .attr('id', 'fpgaBarGrad').attr('x1', 0).attr('y1', 1).attr('x2', 0).attr('y2', 0);
  fpgaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#b45309').attr('stop-opacity', 0.6);
  fpgaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.85);

  // CPU bar gradient
  const cpuGrad = defs.append('linearGradient')
    .attr('id', 'cpuBarGrad').attr('x1', 0).attr('y1', 1).attr('x2', 0).attr('y2', 0);
  cpuGrad.append('stop').attr('offset', '0%').attr('stop-color', '#4338ca').attr('stop-opacity', 0.4);
  cpuGrad.append('stop').attr('offset', '100%').attr('stop-color', '#6366f1').attr('stop-opacity', 0.65);

  // Glow filter
  const glow = defs.append('filter').attr('id', 'barGlow');
  glow.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
  glow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

  // ---- Scales ----
  // X: bin midpoints
  const binMids = fpga_counts.map((_, i) => (bin_edges[i] + bin_edges[i + 1]) / 2);

  const x = d3.scaleBand()
    .domain(d3.range(binCount))
    .range([0, innerWidth])
    .paddingInner(0.15)
    .paddingOuter(0.05);

  const x1 = d3.scaleBand()
    .domain(['fpga', 'cpu'])
    .range([0, x.bandwidth()])
    .padding(0.06);

  const yMax = d3.max([...fpga_counts, ...cpu_counts]) * 1.1;
  const y = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]);

  // ---- Grid ----
  g.append('g').attr('class', 'dash-grid-lines')
    .selectAll('line').data(y.ticks(4)).join('line')
    .attr('x1', 0).attr('x2', innerWidth)
    .attr('y1', d => y(d)).attr('y2', d => y(d));

  // ---- Axes ----
  const xAxis = d3.axisBottom(x)
    .tickFormat(i => {
      if (binCount > 16 && i % 3 !== 0) return '';
      return `$${binMids[i].toFixed(0)}`;
    })
    .tickSize(0)
    .tickPadding(8);

  g.append('g')
    .attr('class', 'dash-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('transform', 'rotate(-35)')
    .style('text-anchor', 'end');

  g.append('g')
    .attr('class', 'dash-axis')
    .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8).tickFormat(d3.format(',')))
    .call(g => g.select('.domain').remove());

  // ---- Bars ----
  const groups = g.selectAll('.hist-group')
    .data(d3.range(binCount))
    .join('g')
    .attr('class', 'hist-group')
    .attr('transform', i => `translate(${x(i)},0)`);

  // FPGA bars
  groups.append('rect')
    .attr('x', x1('fpga'))
    .attr('width', x1.bandwidth())
    .attr('rx', 2)
    .attr('y', innerHeight)
    .attr('height', 0)
    .attr('fill', 'url(#fpgaBarGrad)')
    .transition()
    .duration(dur(900))
    .delay((_, i) => dur(i * 25))
    .ease(d3.easeCubicOut)
    .attr('y', i => y(fpga_counts[i]))
    .attr('height', i => innerHeight - y(fpga_counts[i]));

  // CPU bars
  groups.append('rect')
    .attr('x', x1('cpu'))
    .attr('width', x1.bandwidth())
    .attr('rx', 2)
    .attr('y', innerHeight)
    .attr('height', 0)
    .attr('fill', 'url(#cpuBarGrad)')
    .transition()
    .duration(dur(900))
    .delay((_, i) => dur(i * 25 + 80))
    .ease(d3.easeCubicOut)
    .attr('y', i => y(cpu_counts[i]))
    .attr('height', i => innerHeight - y(cpu_counts[i]));

  // ---- Density Curve Overlay (FPGA) ----
  const densityLine = d3.line()
    .x((_, i) => x(i) + x.bandwidth() / 2)
    .y(d => y(d))
    .curve(d3.curveCatmullRom.alpha(0.5));

  // Glow layer
  g.append('path')
    .datum(fpga_counts)
    .attr('d', densityLine)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 3)
    .attr('stroke-opacity', 0.15)
    .attr('filter', 'url(#barGlow)');

  // Crisp density line
  const densityPath = g.append('path')
    .datum(fpga_counts)
    .attr('d', densityLine)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 1.2)
    .attr('stroke-opacity', 0.5);

  if (!prefersReducedMotion) {
    const len = densityPath.node().getTotalLength();
    densityPath
      .attr('stroke-dasharray', len)
      .attr('stroke-dashoffset', len)
      .transition()
      .duration(dur(1200))
      .delay(dur(binCount * 25))
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);
  }

  // ---- Start price indicator ----
  // Find x position for start price
  const startBinIdx = binMids.findIndex((mid, i) =>
    bin_edges[i] <= startPrice && startPrice < bin_edges[i + 1]
  );
  if (startBinIdx >= 0) {
    const sx = x(startBinIdx) + x.bandwidth() / 2;
    g.append('line')
      .attr('x1', sx).attr('x2', sx)
      .attr('y1', 0).attr('y2', innerHeight)
      .attr('stroke', 'rgba(255,255,255,0.2)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 4');

    g.append('text')
      .attr('x', sx + 4).attr('y', 10)
      .attr('font-family', 'var(--d-font-mono)')
      .attr('font-size', '8px')
      .attr('fill', 'rgba(255,255,255,0.3)')
      .text('S₀');
  }

  // ---- Hover tooltip ----
  const container = d3.select(selector);
  let tooltip = container.select('.chart-tooltip');
  if (tooltip.empty()) {
    tooltip = container.append('div').attr('class', 'chart-tooltip');
  }

  groups
    .on('mouseover', function (event, i) {
      d3.select(this).selectAll('rect').attr('filter', 'url(#barGlow)');
      const range = `$${bin_edges[i].toFixed(0)} - $${bin_edges[i + 1].toFixed(0)}`;
      tooltip.classed('visible', true)
        .html(`<div class="tt-label">${range}</div><div class="tt-val">FPGA: ${fpga_counts[i].toLocaleString()}</div><div style="color:#6366f1">CPU: ${cpu_counts[i].toLocaleString()}</div>`);
    })
    .on('mousemove', function (event) {
      const [mx, my] = d3.pointer(event, chart.svg.node());
      tooltip.style('left', (mx + 12) + 'px').style('top', (my - 12) + 'px');
    })
    .on('mouseleave', function () {
      d3.select(this).selectAll('rect').attr('filter', null);
      tooltip.classed('visible', false);
    });
}

export function destroyHistogramChart(selector) {
  const container = d3.select(selector);
  container.selectAll('svg').remove();
  container.selectAll('.chart-tooltip').remove();
}
