'use client'

import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(apiUrl: string) {
  if (socket) return socket
  socket = io(apiUrl, {
    withCredentials: true,
    transports: ['websocket'],
  })
  return socket
}

export function disconnectSocket() {
  if (!socket) return
  socket.disconnect()
  socket = null
}

