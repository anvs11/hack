import { useEffect, useRef, useState } from 'react'

type Node = {
  position: [number, number, number]
  color: [number, number, number]
  size: number
}

const vertexShader = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  attribute float aSize;
  uniform vec2 uRotation;
  uniform float uAspect;
  uniform float uScale;
  varying vec3 vColor;

  void main() {
    float cy = cos(uRotation.x);
    float sy = sin(uRotation.x);
    float cx = cos(uRotation.y);
    float sx = sin(uRotation.y);
    vec3 p = aPosition;
    p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
    p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
    float depth = 4.6 - p.z;
    gl_Position = vec4((p.x * uScale / depth) / uAspect, p.y * uScale / depth, 0.0, 1.0);
    gl_PointSize = aSize * uScale / depth;
    vColor = aColor;
  }
`

const fragmentShader = `
  precision mediump float;
  uniform float uPoints;
  varying vec3 vColor;

  void main() {
    if (uPoints > 0.5) {
      vec2 point = gl_PointCoord - vec2(0.5);
      float radius = length(point);
      if (radius > 0.5) discard;
      float sphere = sqrt(max(0.0, 1.0 - radius * radius * 4.0));
      float light = 0.42 + sphere * 0.7 + point.x * -0.2;
      gl_FragColor = vec4(vColor * light, 1.0);
    } else {
      gl_FragColor = vec4(vColor, 0.42);
    }
  }
`

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function makeNodes(compact: boolean) {
  const total = compact ? 22 : 40
  let seed = 9137
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  return Array.from({ length: total }, (_, index): Node => {
    const angle = index * 2.399 + random() * 0.4
    const radius = 0.45 + random() * 1.25
    const color = index % 5 === 0
      ? [0.08, 0.18, 0.95]
      : index % 3 === 0
        ? [0.92, 0.94, 1]
        : [0.035, 0.04, 0.055]

    return {
      position: [
        Math.cos(angle) * radius,
        (random() - 0.5) * 2.2,
        Math.sin(angle) * radius,
      ],
      color: color as [number, number, number],
      size: 52 + random() * 70,
    }
  })
}

export default function HeroVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const scrollRef = useRef(0)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (typeof WebGLRenderingContext === 'undefined') {
      setFallback(true)
      return
    }

    const mediaMatches = (query: string) =>
      typeof window.matchMedia === 'function' && window.matchMedia(query).matches
    const reducedMotion = mediaMatches('(prefers-reduced-motion: reduce)')
    const compact = mediaMatches('(max-width: 680px)')
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      powerPreference: compact ? 'low-power' : 'high-performance',
    })

    if (!gl) {
      setFallback(true)
      return
    }

    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader)
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) {
      setFallback(true)
      return
    }

    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFallback(true)
      return
    }

    const nodes = makeNodes(compact)
    const pointPositions = new Float32Array(nodes.flatMap((node) => node.position))
    const pointColors = new Float32Array(nodes.flatMap((node) => node.color))
    const pointSizes = new Float32Array(nodes.map((node) => node.size))
    const linePositions: number[] = []
    const lineColors: number[] = []

    nodes.forEach((node, index) => {
      nodes.slice(index + 1).forEach((other) => {
        const distance = Math.hypot(
          node.position[0] - other.position[0],
          node.position[1] - other.position[1],
          node.position[2] - other.position[2],
        )
        if (distance < (compact ? 0.8 : 0.7)) {
          linePositions.push(...node.position, ...other.position)
          lineColors.push(0.25, 0.3, 0.6, 0.25, 0.3, 0.6)
        }
      })
    })
    const linePositionData = new Float32Array(linePositions)
    const lineColorData = new Float32Array(lineColors)

    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    const colorLocation = gl.getAttribLocation(program, 'aColor')
    const sizeLocation = gl.getAttribLocation(program, 'aSize')
    const rotationLocation = gl.getUniformLocation(program, 'uRotation')
    const aspectLocation = gl.getUniformLocation(program, 'uAspect')
    const scaleLocation = gl.getUniformLocation(program, 'uScale')
    const pointsLocation = gl.getUniformLocation(program, 'uPoints')
    const pointPositionBuffer = gl.createBuffer()
    const pointColorBuffer = gl.createBuffer()
    const pointSizeBuffer = gl.createBuffer()
    const linePositionBuffer = gl.createBuffer()
    const lineColorBuffer = gl.createBuffer()

    const uploadAttribute = (buffer: WebGLBuffer | null, data: Float32Array) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    }
    const bindAttribute = (buffer: WebGLBuffer | null, location: number, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }

    gl.useProgram(program)
    uploadAttribute(pointPositionBuffer, pointPositions)
    uploadAttribute(pointColorBuffer, pointColors)
    uploadAttribute(pointSizeBuffer, pointSizes)
    uploadAttribute(linePositionBuffer, linePositionData)
    uploadAttribute(lineColorBuffer, lineColorData)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0.055, 0.06, 0.082, 1)

    let rotationX = -0.35
    let rotationY = 0.12
    let visible = !document.hidden

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2)
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }
    }

    const draw = (time: number) => {
      resize()
      const targetX = pointerRef.current.x * 0.34 + scrollRef.current * 0.5
      const targetY = pointerRef.current.y * 0.22 - scrollRef.current * 0.2
      rotationX += (targetX - rotationX) * 0.035
      rotationY += (targetY - rotationY) * 0.035
      const drift = reducedMotion ? 0 : time * 0.00007

      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(rotationLocation, rotationX + drift, rotationY)
      gl.uniform1f(aspectLocation, canvas.width / canvas.height)
      gl.uniform1f(scaleLocation, compact ? 4.4 : 5.2)

      bindAttribute(linePositionBuffer, positionLocation, 3)
      bindAttribute(lineColorBuffer, colorLocation, 3)
      gl.disableVertexAttribArray(sizeLocation)
      gl.vertexAttrib1f(sizeLocation, 1)
      gl.uniform1f(pointsLocation, 0)
      gl.drawArrays(gl.LINES, 0, linePositions.length / 3)

      bindAttribute(pointPositionBuffer, positionLocation, 3)
      bindAttribute(pointColorBuffer, colorLocation, 3)
      bindAttribute(pointSizeBuffer, sizeLocation, 1)
      gl.uniform1f(pointsLocation, 1)
      gl.drawArrays(gl.POINTS, 0, nodes.length)

      if (!reducedMotion && visible) frameRef.current = requestAnimationFrame(draw)
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = {
        x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
      }
    }
    const onPointerLeave = () => { pointerRef.current = { x: 0, y: 0 } }
    const onScroll = () => {
      const rect = canvas.getBoundingClientRect()
      scrollRef.current = Math.max(-1, Math.min(1, -rect.top / Math.max(rect.height, 1)))
    }
    const onVisibilityChange = () => {
      visible = !document.hidden
      if (visible && !reducedMotion && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(draw)
      }
      if (!visible && frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    draw(0)

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [])

  return (
    <div className={`hero-visual ${fallback ? 'hero-visual-fallback' : ''}`}>
      <canvas
        ref={canvasRef}
        aria-label="Абстрактная аналитическая сеть сигналов"
        role="img"
      />
      <div className="visual-fallback" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      <div className="visual-caption" aria-hidden="true">
        <span>Live signal map</span>
        <span>05 / nodes online</span>
      </div>
      <div className="cursor-orbit" aria-hidden="true">+</div>
    </div>
  )
}
