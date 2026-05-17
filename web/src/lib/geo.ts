// Países disponibles en el sistema
export const COUNTRIES = ['Argentina', 'Brasil', 'Colombia', 'México'] as const
export type Country = typeof COUNTRIES[number]

// Ciudades por país
export const CITIES_BY_COUNTRY: Record<string, string[]> = {
  Argentina: [
    'Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'Tucumán',
    'La Plata', 'Mar del Plata', 'Salta', 'Santa Fe', 'San Juan',
    'Resistencia', 'Neuquén', 'Santiago del Estero', 'Corrientes', 'Posadas',
    'San Salvador de Jujuy', 'Bahía Blanca', 'Paraná', 'Formosa', 'San Luis',
    'Río Cuarto', 'Comodoro Rivadavia', 'San Rafael', 'Concordia', 'Tandil',
  ],
  Brasil: [
    'São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza',
    'Belo Horizonte', 'Manaus', 'Curitiba', 'Recife', 'Porto Alegre',
    'Belém', 'Goiânia', 'Guarulhos', 'Campinas', 'São Luís',
    'Maceió', 'Natal', 'Teresina', 'Campo Grande', 'João Pessoa',
    'Florianópolis', 'São Bernardo do Campo', 'Nova Iguaçu', 'São José dos Campos', 'Ribeirão Preto',
  ],
  Colombia: [
    'Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena',
    'Cúcuta', 'Bucaramanga', 'Pereira', 'Santa Marta', 'Ibagué',
    'Manizales', 'Pasto', 'Neiva', 'Villavicencio', 'Armenia',
    'Valledupar', 'Montería', 'Sincelejo', 'Popayán', 'Barrancabermeja',
    'Tunja', 'Riohacha', 'Quibdó', 'Florencia', 'Mocoa',
  ],
  México: [
    'Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Toluca',
    'Tijuana', 'León', 'Ciudad Juárez', 'Torreón', 'Querétaro',
    'San Luis Potosí', 'Mérida', 'Mexicali', 'Aguascalientes', 'Culiacán',
    'Acapulco', 'Hermosillo', 'Saltillo', 'Morelia', 'Chihuahua',
    'Cancún', 'Veracruz', 'Oaxaca', 'Villahermosa', 'Tuxtla Gutiérrez',
  ],
}

// Jornadas de trabajo
export const SHIFTS = [
  { value: 'mañana',   label: 'Mañana',   hint: '06:00–14:00' },
  { value: 'tarde',    label: 'Tarde',    hint: '14:00–22:00' },
  { value: 'noche',    label: 'Noche',    hint: '22:00–06:00' },
  { value: 'completa', label: 'Completa', hint: '08:00–17:00' },
  { value: 'rotativo', label: 'Rotativo', hint: 'Turnos variables' },
] as const

export type ShiftValue = typeof SHIFTS[number]['value']

export const SHIFT_COLORS: Record<string, string> = {
  mañana:   'bg-amber-500/10 text-amber-600 border-amber-500/20',
  tarde:    'bg-orange-500/10 text-orange-600 border-orange-500/20',
  noche:    'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  completa: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  rotativo: 'bg-text-muted/10 text-text-muted border-border',
}
