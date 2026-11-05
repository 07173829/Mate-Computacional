// Casos reales precargados. Cada matriz es simétrica, con ceros en la diagonal
// y 0 = sin conexión directa entre ese par de puntos.
window.CASOS = [
  {
    id: "samu-sjl",
    titulo: "SAMU — Ambulancia en San Juan de Lurigancho",
    resumen: "Una ambulancia del SAMU (Minsa) debe llegar desde su base hasta una emergencia en la zona alta de San Juan de Lurigancho. Los puntos intermedios son establecimientos de salud reales del registro del Minsa, usados como referencias de la red vial. El peso de cada arista es el tiempo estimado de viaje en minutos.",
    supuestos: "Tiempo (min) = distancia en línea recta × 1,4 (factor de desvío por calles) ÷ 25 km/h (velocidad promedio en hora punta) × 60, redondeado. Cada punto se conecta con sus 3 vecinos más cercanos. La base y el punto de emergencia son ubicaciones supuestas.",
    unidad: "min",
    origen: 0,
    destino: 11,
    nombres: [
      "Base SAMU (ubicación supuesta, sur de SJL)",
      "Ref. Sonrisa Segura San Juan de Lurigancho",
      "Ref. Policlínico Las Lomas",
      "Ref. Meli Dental",
      "Ref. Consultorio Dental El Pueblo",
      "Ref. Inspirent Odontología Integral",
      "Ref. Medicina Física y Rehabilitación Integral Micari",
      "Ref. DentiKids H&E",
      "Ref. VSIRIDENT",
      "Ref. GM Perú Salud",
      "Ref. MED&SALUD",
      "Punto de emergencia (ubicación supuesta, zona alta de SJL)"
    ],
    matriz: [
      [0, 5, 11, 11, 0, 0, 0, 0, 0, 0, 0, 0],
      [5, 0, 6, 0, 8, 0, 0, 0, 0, 0, 0, 0],
      [11, 6, 0, 0, 0, 7, 0, 8, 0, 0, 0, 0],
      [11, 0, 0, 0, 3, 8, 4, 0, 10, 0, 0, 0],
      [0, 8, 0, 3, 0, 4, 6, 13, 0, 0, 0, 0],
      [0, 0, 7, 8, 4, 0, 0, 10, 0, 0, 0, 0],
      [0, 0, 0, 4, 6, 0, 0, 0, 6, 7, 0, 0],
      [0, 0, 8, 0, 13, 10, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 10, 0, 0, 6, 0, 0, 6, 10, 21],
      [0, 0, 0, 0, 0, 0, 7, 0, 6, 0, 5, 16],
      [0, 0, 0, 0, 0, 0, 0, 0, 10, 5, 0, 11],
      [0, 0, 0, 0, 0, 0, 0, 0, 21, 16, 11, 0]
    ]
  }
];
