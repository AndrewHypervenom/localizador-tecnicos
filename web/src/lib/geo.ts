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

// Shift stored as "HH:MM-HH:MM", e.g. "08:00-17:00"
export function parseShift(shift: string | null): { start: string; end: string } {
  if (!shift) return { start: '', end: '' }
  const m = shift.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  return m ? { start: m[1], end: m[2] } : { start: '', end: '' }
}

export function buildShift(start: string, end: string): string | null {
  return start && end ? `${start}-${end}` : null
}
