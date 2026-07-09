/**
 * chart.js
 * -----------------------------------------------------------------------
 * Thin wrapper around Chart.js. Owns the canvas instance; everything
 * else talks to it through the two exported functions below.
 */

let liveChart = null;

function buildGradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, color.fill0);
  g.addColorStop(1, color.fill1);
  return g;
}

export function initChart(canvasId) {
  const ctx = document.getElementById(canvasId).getContext('2d');

  liveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Price',
          data: [],
          borderColor: '#22d3ee',
          borderWidth: 2.25,
          pointRadius: 0,
          fill: true,
          backgroundColor: buildGradient(ctx, { fill0: 'rgba(34,211,238,0.20)', fill1: 'rgba(34,211,238,0)' }),
          tension: 0.15,
          order: 3
        },
        {
          label: 'EMA 9',
          data: [],
          borderColor: '#fbbf24',
          borderWidth: 1.25,
          pointRadius: 0,
          fill: false,
          tension: 0.15,
          order: 1
        },
        {
          label: 'EMA 21',
          data: [],
          borderColor: '#a78bfa',
          borderWidth: 1.25,
          pointRadius: 0,
          fill: false,
          tension: 0.15,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { right: 10, left: 4, top: 10 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#8b93a3', boxWidth: 10, font: { size: 10, family: 'Space Grotesk' } }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 5, color: '#5b6472', font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#5b6472', font: { size: 10, family: 'JetBrains Mono' } },
          grid: { color: '#1b2129' }
        }
      }
    }
  });

  return liveChart;
}

/** Pushes a fresh window of ticks + indicator overlays into the chart. */
export function updateChart(ticks, indicators) {
  if (!liveChart) return;

  const labels = ticks.map(t => t.t.toLocaleTimeString([], { hour12: false }));
  const prices = ticks.map(t => t.price);

  liveChart.data.labels = labels;
  liveChart.data.datasets[0].data = prices;

  // EMA overlays are single trailing values from computeAll(); draw them
  // as flat reference lines across the visible window rather than
  // recomputing a full EMA series on every tick (keeps this cheap).
  liveChart.data.datasets[1].data = indicators.ema9 != null ? prices.map(() => indicators.ema9) : [];
  liveChart.data.datasets[2].data = indicators.ema21 != null ? prices.map(() => indicators.ema21) : [];

  liveChart.update('none');
}
