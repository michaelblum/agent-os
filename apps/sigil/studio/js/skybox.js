// Procedural Milky Way skybox — 3 layers, zero external assets
import state from '../../renderer/state.js';

// ── Helpers ──────────────────────────────────────────────────────────

function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── GLSL Chunks ─────────────────────────────────────────────────────

const simplexNoise3D = /* glsl */ `
// Ashima/webgl-noise simplex3D — public domain
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ── Layer 1: Nebula Sphere ──────────────────────────────────────────

function createNebula() {
    const geo = new THREE.SphereGeometry(500, 32, 32);

    const vertexShader = /* glsl */ `
        varying vec3 vPosition;
        void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShader = /* glsl */ `
        ${simplexNoise3D}

        uniform float uTime;
        varying vec3 vPosition;

        float fbm(vec3 p) {
            float val = 0.0;
            float amp = 0.5;
            float freq = 1.0;
            for (int i = 0; i < 3; i++) {
                val += amp * snoise(p * freq);
                freq *= 2.0;
                amp *= 0.5;
            }
            return val;
        }

        void main() {
            vec3 dir = normalize(vPosition);

            // Spherical coords
            float phi = asin(dir.y);                   // -PI/2..PI/2
            float theta = atan(dir.z, dir.x);           // -PI..PI

            // Equatorial band concentration
            float bandwidth = 0.35;
            float bandIntensity = exp(-(phi * phi) / (bandwidth * bandwidth));

            // Slow drift
            float drift = uTime * 0.001;
            vec3 noiseCoord = dir * 3.0 + vec3(drift, 0.0, drift * 0.5);
            float n = fbm(noiseCoord) * 0.5 + 0.5;     // 0..1

            // Combine band + noise
            float intensity = bandIntensity * n;

            // Color palette: deep purple -> dark blue -> faint warm dust
            vec3 deepPurple = vec3(0.067, 0.0, 0.133);   // #110022
            vec3 darkBlue   = vec3(0.039, 0.039, 0.165);  // #0a0a2a
            vec3 warmDust   = vec3(0.165, 0.102, 0.102);  // #2a1a1a

            vec3 col = mix(deepPurple, darkBlue, smoothstep(0.0, 0.4, intensity));
            col = mix(col, warmDust, smoothstep(0.4, 0.8, intensity) * 0.3);

            // Keep brightness low
            col *= 0.6;

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0.0 } },
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    state.skyboxNebula = mesh;
    state.scene.add(mesh);
    return mesh;
}

// ── Layer 2: Milky Way Band Stars ───────────────────────────────────

function createBandStars() {
    const count = 30000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const radius = 490;
    const bandWidth = 0.15;

    for (let i = 0; i < count; i++) {
        // Random point on sphere with Gaussian Y concentration
        const theta = Math.random() * Math.PI * 2;
        const yNorm = gaussianRandom() * bandWidth;             // Gaussian-biased Y
        const y = Math.max(-1, Math.min(1, yNorm));             // clamp to unit sphere
        const r = Math.sqrt(1 - y * y);                         // radius at this Y

        positions[i * 3]     = Math.cos(theta) * r * radius;
        positions[i * 3 + 1] = y * radius;
        positions[i * 3 + 2] = Math.sin(theta) * r * radius;

        sizes[i] = Math.random() ** 3 * 1.5 + 0.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const shaderMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0xccccff) },
            uOpacity: { value: 0.7 }
        },
        vertexShader: /* glsl */ `
            attribute float size;
            void main() {
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size;
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uOpacity;
            void main() {
                float dist = distance(gl_PointCoord, vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = uOpacity * (1.0 - smoothstep(0.3, 0.5, dist));
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const points = new THREE.Points(geo, shaderMat);
    state.skyboxStars = points;
    state.scene.add(points);
    return points;
}

// ── Layer 3: Hero Stars ─────────────────────────────────────────────

function createHeroStars() {
    const count = 500;
    const radius = 480;
    const positions = new Float32Array(count * 3);
    const aSizes = new Float32Array(count);
    const aPhases = new Float32Array(count);
    const aColors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // Uniform spherical scatter
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * radius;
        positions[i * 3 + 1] = Math.cos(phi) * radius;
        positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

        aSizes[i] = Math.random() ** 2 * 4 + 1;
        aPhases[i] = Math.random() * 6.28;

        // Color temperature: lerp blue-white to warm
        const t = Math.random();
        aColors[i * 3]     = 0.8 + t * 0.2;   // R: 0.8 -> 1.0
        aColors[i * 3 + 1] = 0.85 + t * 0.05;  // G: 0.85 -> 0.9
        aColors[i * 3 + 2] = 1.0 - t * 0.3;    // B: 1.0 -> 0.7
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhases, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColors, 3));

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 }
        },
        vertexShader: /* glsl */ `
            attribute float aSize;
            attribute float aPhase;
            attribute vec3 aColor;
            uniform float uTime;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vColor = aColor;
                // Twinkle: slow sinusoidal alpha modulation
                vAlpha = 0.6 + 0.4 * sin(uTime * 0.8 + aPhase);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * vAlpha;
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                // Soft radial glow from gl_PointCoord
                float dist = distance(gl_PointCoord, vec2(0.5));
                float glow = 1.0 - smoothstep(0.0, 0.5, dist);
                if (glow < 0.01) discard;
                gl_FragColor = vec4(vColor, glow * vAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const points = new THREE.Points(geo, mat);
    state.skyboxHeroStars = points;
    state.scene.add(points);
    return points;
}

// ── Public API ──────────────────────────────────────────────────────

export function createSkybox() {
    createNebula();
    createBandStars();
    createHeroStars();

    // Tilt the skybox so the Milky Way band is diagonal/off-center
    // in the default 2D head-on view (camera at 0,0,z looking at origin).
    // This points the camera at a quieter patch of sky by default.
    const tilt = new THREE.Euler(1.1, 0.4, 0);  // ~63° X, ~23° Y
    if (state.skyboxNebula) state.skyboxNebula.rotation.copy(tilt);
    if (state.skyboxStars)  state.skyboxStars.rotation.copy(tilt);
    if (state.skyboxHeroStars) state.skyboxHeroStars.rotation.copy(tilt);
}

export function animateSkybox(dt) {
    const t = performance.now() * 0.001; // seconds

    if (state.skyboxNebula) {
        state.skyboxNebula.material.uniforms.uTime.value = t;
    }
    if (state.skyboxHeroStars) {
        state.skyboxHeroStars.material.uniforms.uTime.value = t;
    }
}
