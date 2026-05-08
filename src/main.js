import Chart from 'chart.js/auto';
import './styles.css';

const racePalette = ['#d64545', '#1f6fb2', '#2f8f5b', '#a85dd1', '#db7c26', '#1f8a8a', '#c0577a', '#6078d8'];
const raceModules = import.meta.glob('../courses/*.gpx', { eager: true, import: 'default', query: '?url' });

const fileNameFromPath = (path) => path.split('/').at(-1) ?? path;
const fileStemFromPath = (path) => fileNameFromPath(path).replace(/\.gpx$/i, '');
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const titleCaseWord = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

function formatFallbackLabel(filePath) {
  return fileStemFromPath(filePath)
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/[0-9]/.test(word) ? word.toUpperCase() : titleCaseWord(word)))
    .join(' ');
}

function cleanRaceName(name) {
  return name.replace(/\s+-\s+\d+(?:\.\d+)?\s*km$/i, '').trim();
}

function preferParsedName(name) {
  if (!name || name === 'Unnamed race') {
    return false;
  }

  return !/^(marathon|half marathon|activity)$/i.test(name.trim());
}

const races = Object.entries(raceModules)
  .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
  .map(([filePath, file], index) => ({
    id: slugify(fileStemFromPath(filePath)),
    label: formatFallbackLabel(filePath),
    fallbackLabel: formatFallbackLabel(filePath),
    file,
    color: racePalette[index % racePalette.length],
  }));

const chartCanvas = document.querySelector('#elevation-chart');
const chartSummary = document.querySelector('#chart-summary');
const raceForm = document.querySelector('#race-form');

const toRadians = (degrees) => (degrees * Math.PI) / 180;

function haversineDistanceMeters(firstPoint, secondPoint) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(secondPoint.lat - firstPoint.lat);
  const longitudeDelta = toRadians(secondPoint.lon - firstPoint.lon);
  const firstLatitude = toRadians(firstPoint.lat);
  const secondLatitude = toRadians(secondPoint.lat);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(gpxText) {
  const xml = new DOMParser().parseFromString(gpxText, 'application/xml');
  const parserError = xml.querySelector('parsererror');

  if (parserError) {
    throw new Error('Could not parse GPX file.');
  }

  const name =
    xml.querySelector('metadata > name')?.textContent?.trim() ||
    xml.querySelector('trk > name')?.textContent?.trim() ||
    xml.querySelector('rte > name')?.textContent?.trim() ||
    'Unnamed race';

  const trackPointNodes = Array.from(xml.getElementsByTagNameNS('*', 'trkpt'));
  const routePointNodes = Array.from(xml.getElementsByTagNameNS('*', 'rtept'));
  const pointNodes = trackPointNodes.length > 0 ? trackPointNodes : routePointNodes;

  const points = pointNodes.map((pointNode) => ({
    lat: Number.parseFloat(pointNode.getAttribute('lat') ?? '0'),
    lon: Number.parseFloat(pointNode.getAttribute('lon') ?? '0'),
    elevation: Number.parseFloat(pointNode.getElementsByTagNameNS('*', 'ele')[0]?.textContent ?? 'NaN'),
  }));

  let cumulativeDistanceMeters = 0;
  const profile = points.map((point, index) => {
    if (index > 0) {
      cumulativeDistanceMeters += haversineDistanceMeters(points[index - 1], point);
    }

    return {
      x: cumulativeDistanceMeters / 1000,
      y: Number.isFinite(point.elevation) ? point.elevation : null,
    };
  });

  const elevations = profile.map((point) => point.y).filter((elevation) => Number.isFinite(elevation));
  const hasElevation = elevations.length > 0;

  return {
    name,
    profile,
    hasElevation,
    maxElevation: hasElevation ? Math.max(...elevations) : null,
    distanceKm: profile.at(-1)?.x ?? 0,
  };
}

async function loadRaces() {
  return Promise.all(
    races.map(async (race) => {
      const response = await fetch(race.file);
      if (!response.ok) {
        throw new Error(`Failed to load ${race.label}`);
      }

      const parsed = parseGpx(await response.text());
      const parsedLabel = cleanRaceName(parsed.name);

      return {
        ...race,
        ...parsed,
        label: preferParsedName(parsedLabel) ? parsedLabel : race.fallbackLabel,
      };
    }),
  );
}

function createRaceControl(race, checked) {
  const label = document.createElement('label');
  label.className = 'race-option';
  if (!race.hasElevation) {
    label.classList.add('is-disabled');
  }

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = race.id;
  input.value = race.id;
  input.checked = checked && race.hasElevation;
  input.disabled = !race.hasElevation;

  const swatch = document.createElement('span');
  swatch.className = 'race-swatch';
  swatch.style.setProperty('--swatch-color', race.color);

  const text = document.createElement('span');
  text.className = 'race-option-text';
  text.innerHTML = `
    <strong>${race.label}</strong>
    <small>${race.distanceKm.toFixed(1)} km${race.hasElevation ? '' : ' · elevation unavailable'}</small>
  `;

  label.append(input, swatch, text);
  return label;
}

function getSelectedRaces(loadedRaces) {
  const selectedIds = new Set(
    Array.from(raceForm.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value),
  );

  return loadedRaces.filter((race) => selectedIds.has(race.id));
}

function buildDatasets(selectedRaces) {
  return selectedRaces.map((race) => ({
    label: race.label,
    data: race.profile,
    borderColor: race.color,
    backgroundColor: `${race.color}20`,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    cubicInterpolationMode: 'monotone',
    tension: 0.25,
  }));
}

function updateSummary(selectedRaces) {
  if (selectedRaces.length === 0) {
    const unavailableCount = races.length - raceForm.querySelectorAll('input:not(:disabled)').length;
    chartSummary.textContent = unavailableCount > 0
      ? 'Select at least one race with elevation data to display a profile.'
      : 'Select at least one race to display a profile.';
    return;
  }

  const maxElevation = Math.max(...selectedRaces.map((race) => race.maxElevation));
  chartSummary.textContent = `${selectedRaces.length} race${selectedRaces.length === 1 ? '' : 's'} selected · max elevation ${maxElevation.toFixed(0)} m`;
}

function createChart() {
  return new Chart(chartCanvas, {
    type: 'line',
    data: {
      datasets: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            color: '#152033',
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const { dataset, parsed } = context;
              return `${dataset.label}: ${parsed.y.toFixed(0)} m at ${parsed.x.toFixed(1)} km`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: 'Distance (km)',
            color: '#152033',
          },
          ticks: {
            color: '#43506a',
          },
          grid: {
            color: 'rgba(21, 32, 51, 0.08)',
          },
        },
        y: {
          title: {
            display: true,
            text: 'Elevation (m)',
            color: '#152033',
          },
          beginAtZero: true,
          ticks: {
            color: '#43506a',
          },
          grid: {
            color: 'rgba(21, 32, 51, 0.08)',
          },
        },
      },
    },
  });
}

function syncChart(chart, selectedRaces) {
  const maxElevation = selectedRaces.length > 0 ? Math.max(...selectedRaces.map((race) => race.maxElevation)) : 100;

  chart.data.datasets = buildDatasets(selectedRaces);
  chart.options.scales.y.max = Math.ceil(maxElevation / 10) * 10;
  chart.update();
  updateSummary(selectedRaces);
}

async function main() {
  const loadedRaces = await loadRaces();
  const availableRaces = loadedRaces.filter((race) => race.hasElevation);

  loadedRaces.forEach((race, index) => {
    raceForm.append(createRaceControl(race, availableRaces.indexOf(race) > -1 && availableRaces.indexOf(race) < 2));
  });

  const chart = createChart();
  syncChart(chart, getSelectedRaces(loadedRaces));

  raceForm.addEventListener('change', () => {
    syncChart(chart, getSelectedRaces(loadedRaces));
  });
}

main().catch((error) => {
  chartSummary.textContent = error.message;
  console.error(error);
});