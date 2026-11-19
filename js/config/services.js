export const HERITAGE_LAYERS = [
  {
    id: 'listed-buildings',
    category: 'Listed Buildings',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0',
    color: '#d97706',
  },
  {
    id: 'scheduled-monuments',
    category: 'Scheduled Monuments',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/1',
    color: '#dc2626',
  },
  {
    id: 'parks-gardens',
    category: 'Registered Parks & Gardens',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/2',
    color: '#16a34a',
  },
  {
    id: 'battlefields',
    category: 'Registered Battlefields',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/3',
    color: '#9333ea',
  },
  {
    id: 'world-heritage-sites',
    category: 'World Heritage Sites',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/4',
    color: '#2563eb',
  },
  {
    id: 'conservation-areas',
    category: 'Conservation Areas',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/Conservation_Areas/FeatureServer/0',
    color: '#0d9488',
  },
  {
    id: 'heritage-at-risk',
    category: 'Heritage at Risk',
    url: 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/Heritage_at_Risk/FeatureServer/0',
    color: '#e11d48',
  },
];

export const SAMPLE_SITES = {
  berkhamsted: {
    label: 'Berkhamsted Castle & Environs',
    center: [-0.5586, 51.7634],
    zoom: 15,
  },
  bath: {
    label: 'Bath Spa Historic Core',
    center: [-2.3597, 51.3814],
    zoom: 15,
  },
  stonehenge: {
    label: 'Stonehenge World Heritage Environs',
    center: [-1.8262, 51.1789],
    zoom: 14,
  },
  hadriansWall: {
    label: 'Housesteads Roman Fort',
    center: [-2.3311, 55.0131],
    zoom: 14,
  },
};