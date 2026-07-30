import { useSyncExternalStore } from 'react'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'

/**
 * "Ver como empresa": el superadmin adopta la vista de un líder concreto.
 *
 * Es un disfraz de interfaz, NO una frontera de seguridad — el token sigue
 * siendo de superadmin y quien mire la pestaña de red lo verá. Sirve para
 * revisar o presentar lo que ve un cliente, no para restringir de verdad.
 */
export interface ViewAsCompany {
  id: string
  name: string
}

const KEY = 'geotrack.viewAs'

/*
 * sessionStorage y no localStorage: el modo muere al cerrar la pestaña. Si
 * persistiera, se podría volver días después, ver el panel acotado a una sola
 * empresa y no entender por qué faltan datos.
 */
function read(): ViewAsCompany | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.id ? parsed as ViewAsCompany : null
  } catch {
    return null
  }
}

let current: ViewAsCompany | null = read()
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

/** Empresa que se está suplantando, o `null` si no hay modo vista activo. */
export function getViewAs(): ViewAsCompany | null {
  return current
}

/*
 * Los stores son singletons y las alertas se ACUMULAN (`addAlert` solo añade y
 * deduplica; nada las limpia salvo `reset`). Sin este vaciado, un admin que
 * viene del mapa global entra a ver una empresa y arrastra alertas —con nombres
 * de técnicos— de todas las demás. Vale tanto al entrar como al salir.
 */
function resetSharedStores() {
  useTrackingStore.getState().reset()
  useZonesStore.getState().setZones([])
}

export function setViewAs(company: ViewAsCompany) {
  current = company
  try { sessionStorage.setItem(KEY, JSON.stringify(company)) } catch { /* modo privado */ }
  resetSharedStores()
  emit()
}

export function clearViewAs() {
  current = null
  try { sessionStorage.removeItem(KEY) } catch { /* modo privado */ }
  resetSharedStores()
  emit()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Suscripción para componentes. Devuelve la empresa suplantada o `null`. */
export function useViewAs(): ViewAsCompany | null {
  return useSyncExternalStore(subscribe, getViewAs, getViewAs)
}
