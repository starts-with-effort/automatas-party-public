// Mensajes que acepta el servidor: quién puede enviarlos, su esquema y cuántos por
// segundo por conexión (RNF-08). Cualquier otro mensaje se ignora.
import { z } from 'zod';
import { OPTIONS } from '../domain/duel.js';

const ALL = ['play', 'screen', 'host'];
const id = z.string().min(1).max(32);
const tallerSeq = z.number().int().min(0).max(1_000_000);

export const INBOUND = {
  'time:ping': { roles: ALL, perSecond: 20, schema: z.object({ t0: z.number() }) },
  'time:report': {
    roles: ALL,
    perSecond: 2,
    schema: z.object({ rtt: z.number().min(0).max(60_000), offset: z.number().min(-1e10).max(1e10) }),
  },
  'lobby:join': { roles: ['play'], perSecond: 4, schema: z.object({ teamId: id }) },
  'lobby:leave': { roles: ['play'], perSecond: 4, schema: z.object({}) },
  // Sala con registro: crear el equipo (o corregir el propio). El motor limpia y valida los textos.
  'lobby:register': {
    roles: ['play'],
    perSecond: 2,
    schema: z.object({ name: z.string().max(80), members: z.array(z.string().max(80)).max(12) }),
  },
  // Taller (docs/TALLER.md): una acción sobre el estado del taller del equipo. `seq` es el número de
  // estado que veía el celular: si ya cambió, la acción se descarta (`stale_action`).
  'taller:act': {
    roles: ['play'],
    perSecond: 8,
    schema: z.discriminatedUnion('type', [
      z.object({ type: z.literal('begin'), seq: tallerSeq }),
      z.object({ type: z.literal('stack'), seq: tallerSeq, act: z.enum(['push', 'pop', 'same', 'halt']) }),
      z.object({ type: z.literal('verdict'), seq: tallerSeq, accept: z.boolean() }),
      z.object({ type: z.literal('chip'), seq: tallerSeq, slot: z.number().int().min(0).max(2), value: z.number().int().min(0).max(9).nullable() }),
      z.object({ type: z.literal('next'), seq: tallerSeq }),
      z.object({ type: z.literal('again'), seq: tallerSeq, exercise: z.union([z.literal(1), z.literal(2)]) }),
      z.object({ type: z.literal('back'), seq: tallerSeq }),
    ]),
  },
  // Respuesta del dispositivo de opciones; tClient = ms desde que se habilitaron las opciones.
  'question:answer': {
    roles: ['play'],
    perSecond: 4,
    schema: z.object({
      questionId: id,
      option: z.number().int().min(0).max(3),
      tClient: z.number().min(0).max(600_000).optional(),
    }),
  },
  // Draft: elegir 1 objeto de la oferta (2 con Ticket Dorado).
  'item:pick': {
    roles: ['play'],
    perSecond: 4,
    schema: z.object({ offerId: id, codes: z.array(z.string().max(4)).min(1).max(2) }),
  },
  // Fase de uso: declarar (con objetivo si hace falta), retirar y confirmar.
  'item:declare': { roles: ['play'], perSecond: 6, schema: z.object({ itemId: id, targetTeamId: id.optional() }) },
  'item:undeclare': { roles: ['play'], perSecond: 6, schema: z.object({ itemId: id }) },
  'item:confirm': { roles: ['play'], perSecond: 4, schema: z.object({}) },
  // Duelo: piedra, papel o tijera en la mano en curso.
  'duel:pick': { roles: ['play'], perSecond: 4, schema: z.object({ option: z.enum(OPTIONS) }) },
  // Entrada de minijuego (sección 3.10): clics del Clicker (en lotes cada 200 ms), voltear una carta,
  // un toque en la Traza a ciegas (el estado al que pasa el autómata), el avance del Flappy con sus aleteos (cada 200 ms) y, en la Arena, la
  // posición del vehículo en cada tick con sus disparos (cada reportMs, ~12 por segundo).
  'mg:input': {
    roles: ['play'],
    perSecond: 20,
    schema: z.discriminatedUnion('type', [
      z.object({ type: z.literal('clicks'), count: z.number().int().min(0).max(200) }),
      z.object({ type: z.literal('flip'), card: z.number().int().min(0).max(99) }),
      z.object({ type: z.literal('tap'), state: z.string().regex(/^q[0-9]$/) }),
      z.object({
        type: z.literal('fly'),
        tick: z.number().int().min(0).max(100_000),
        flaps: z.array(z.number().int().min(0).max(100_000)).max(5000),
      }),
      z.object({
        type: z.literal('drive'),
        life: z.number().int().min(1).max(10_000),
        from: z.number().int().min(0).max(100_000),
        pos: z.array(z.number().int().min(0).max(20_000)).max(120), // hasta 60 ticks (2 s)
        f: z.number().int().min(0).max(4095),
        shots: z.array(z.tuple([z.number().int().min(0).max(100_000), z.number().int().min(0).max(4095)])).max(20),
      }),
    ]),
  },
  'host:command': {
    roles: ['host'],
    perSecond: 10,
    schema: z.object({ action: z.string().max(32), data: z.unknown().optional() }),
  },
};

export const HOST_ACTIONS = {
  createRoom: z.object({
    teamCount: z.number().int(),
    names: z.array(z.string().max(30)).max(8).optional(),
    confirm: z.boolean().optional(),
    // Sala de práctica: solo este minijuego, en bucle (null: la partida completa).
    practice: z.string().max(32).nullable().optional(),
    // Sala con registro y taller: los equipos los crean los celulares (teamCount es el máximo).
    workshop: z.boolean().optional(),
  }),
  renameTeam: z.object({ teamId: id, name: z.string().max(80) }),
  removeTeam: z.object({ teamId: id }),
  // Práctica de la Arena: quién es jefe en el próximo intento ([] = según el puntaje).
  setBosses: z.object({ teamIds: z.array(id).max(8) }),
  setLobby: z.object({ open: z.boolean() }),
  start: z.object({ force: z.boolean().optional() }),
  next: z.object({}),
  skip: z.object({}),
  pause: z.object({}),
  resume: z.object({}),
  move: z.object({ deviceId: id, teamId: id.nullable() }),
  kick: z.object({ deviceId: id }),
  // Ajuste manual de puntos (RF-HOST-03): positivo suma, negativo resta.
  adjust: z.object({
    teamId: id,
    points: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0),
    reason: z.string().trim().max(80).optional(),
  }),
  flash: z.object({}),
  announce: z.object({ text: z.string().trim().min(1).max(140) }),
};
