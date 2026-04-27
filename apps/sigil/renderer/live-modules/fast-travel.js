import state from '../state.js';
import { normalizeFastTravelEffect } from '../transition-registry.js';
import { resetOmegaInterdimensionalTrail } from '../omega.js';
import { clampPointToDisplays, desktopWorldToNativePoint, findDisplayForPoint } from './display-utils.js';

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function smoothstep(t) {
    const x = clamp01(t);
    return x * x * (3 - (2 * x));
}

function easeInOutQuad(t) {
    const x = clamp01(t);
    return x < 0.5 ? 2 * x * x : -1 + ((4 - (2 * x)) * x);
}

function smoothstepRange(edge0, edge1, value) {
    const x = clamp01((value - edge0) / (edge1 - edge0));
    return x * x * (3 - (2 * x));
}

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

function easeOutBack(t) {
    const x = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2));
}

function rgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(255,255,255,${alpha})`;
    const value = hex.replace('#', '');
    if (value.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function boolFlag(value, fallback = true) {
    return typeof value === 'boolean' ? value : fallback;
}

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function lineConfig(rendererState) {
    return {
        trailEnabled: boolFlag(rendererState.fastTravelLineInterDimensional, true),
        durationMs: Math.max(50, numberOr(rendererState.fastTravelLineDuration, 0.22) * 1000),
        delayMs: Math.max(0, numberOr(rendererState.fastTravelLineDelay, 0) * 1000),
        repeatCount: Math.max(0, Math.round(numberOr(rendererState.fastTravelLineRepeatCount, 10))),
        repeatDuration: Math.max(0.1, numberOr(rendererState.fastTravelLineRepeatDuration, 2)),
        trailMode: typeof rendererState.fastTravelLineTrailMode === 'string'
            ? rendererState.fastTravelLineTrailMode
            : 'fade',
        lagFactor: clamp(numberOr(rendererState.fastTravelLineLag, 0.05), 0, 0.4),
        scale: Math.max(0.1, numberOr(rendererState.fastTravelLineScale, 1.5)),
    };
}

function wormholeConfig(rendererState) {
    return {
        radius: Math.max(56, Number(rendererState.wormholeCaptureRadius) || 96),
        strength: Number.isFinite(Number(rendererState.wormholeDistortionStrength))
            ? Number(rendererState.wormholeDistortionStrength)
            : 1.2,
        twist: Number.isFinite(Number(rendererState.wormholeTwist))
            ? Number(rendererState.wormholeTwist)
            : Math.PI,
        zoom: Math.max(0.1, numberOr(rendererState.wormholeZoom, 3.5)),
        shadingEnabled: boolFlag(rendererState.wormholeShadingEnabled, true) ? 1 : 0,
        tunnelShadow: clamp(numberOr(rendererState.wormholeTunnelShadow, 0.8), 0, 1),
        specularIntensity: clamp(numberOr(rendererState.wormholeSpecularIntensity, 0.4), 0, 2),
        lightAngle: Number.isFinite(Number(rendererState.wormholeLightAngle))
            ? Number(rendererState.wormholeLightAngle)
            : 2.35,
        objectEnabled: boolFlag(rendererState.wormholeObjectEnabled, true) ? 1 : 0,
        objectHeight: Math.max(0.05, numberOr(rendererState.wormholeObjectHeight, 0.8)),
        objectSpin: numberOr(rendererState.wormholeObjectSpin, 4.5),
        particlesEnabled: boolFlag(rendererState.wormholeParticlesEnabled, true),
        particleDensity: clamp(numberOr(rendererState.wormholeParticleDensity, 0.05), 0, 1),
        flashIntensity: Math.max(0, numberOr(rendererState.wormholeFlashIntensity, 1.5)),
        whitePoint: Math.max(0.1, numberOr(rendererState.wormholeWhitePointIntensity, 1)),
        starburst: Math.max(0, numberOr(rendererState.wormholeStarburstIntensity, 0.95)),
        lensFlare: Math.max(0, numberOr(rendererState.wormholeLensFlareIntensity, 0.8)),
        openingMs: Math.max(80, numberOr(rendererState.wormholeImplosionDuration, 1.5) * 1000),
        objectTravelMs: Math.max(80, numberOr(rendererState.wormholeTravelDuration, 0.5) * 1000),
        closeMs: Math.max(80, numberOr(rendererState.wormholeReboundDuration, 1.2) * 1000),
        captureEnabled: boolFlag(rendererState.wormholeCaptureEnabled, true),
    };
}

function captureImageSource(result) {
    return `data:${result.mimeType};base64,${result.base64}`;
}

function loadImage(result) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = captureImageSource(result);
    });
}

function createCanvasOverlay() {
    let canvas = null;
    let resize = null;

    function ensure() {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);

        resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(window.innerWidth * dpr);
            canvas.height = Math.floor(window.innerHeight * dpr);
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);
        return canvas;
    }

    function context() {
        if (!canvas) return null;
        return canvas.getContext('2d');
    }

    function clear() {
        const ctx = context();
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    function destroy() {
        if (resize) window.removeEventListener('resize', resize);
        resize = null;
        if (canvas) canvas.remove();
        canvas = null;
    }

    return { mount: ensure, context, clear, destroy };
}

const WORMHOLE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_center;
uniform vec2 u_curve;
uniform float u_effectMultiplier;
uniform vec2 u_exitCenter;
uniform vec2 u_curveExit;
uniform float u_exitMultiplier;
uniform float u_radius;
uniform float u_strength;
uniform float u_twist;
uniform float u_zoom;
uniform float u_aspectRatio;
uniform float u_shadingEnabled;
uniform float u_tunnelShadow;
uniform float u_specularIntensity;
uniform float u_lightAngle;
uniform float u_objEnabled;
uniform float u_objProgress;
uniform float u_objHeight;
uniform float u_currentSpinAngle;
uniform float u_flashIntensity;
uniform float u_flashAmount;
uniform float u_time;
uniform vec2 u_textureOrigin;
uniform vec2 u_textureScale;

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
}

vec2 applyHole(vec2 uv, vec2 center, vec2 curve, float multiplier, float isExit, out float outShadow, out float outLight) {
    outShadow = 0.0;
    outLight = 0.0;
    if (multiplier <= 0.001) return vec2(0.0);

    vec2 delta = uv - center;
    delta.x *= u_aspectRatio;
    float dist = length(delta);
    if (dist >= u_radius) return vec2(0.0);

    float percent = dist / u_radius;
    float falloff = smoothstep(1.0, 0.7, percent);
    float distortionPower = exp(u_strength);
    float distortedDist = pow(percent, distortionPower) * u_radius;
    float currentZoom = mix(1.0, u_zoom, falloff * (1.0 - percent));
    distortedDist /= currentZoom;

    float twistDir = isExit > 0.5 ? -1.0 : 1.0;
    float angle = atan(delta.y, delta.x) + u_twist * twistDir * pow(1.0 - percent, 1.5) * falloff * multiplier;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 curveOffset = curve * pow(1.0 - percent, 2.0) * falloff * multiplier;
    vec2 newDelta = dir * distortedDist - curveOffset;
    newDelta.x /= u_aspectRatio;

    if (u_shadingEnabled > 0.5) {
        outShadow = u_tunnelShadow * pow(1.0 - percent, 2.0) * falloff * multiplier;
        float slope = -u_strength * sin(percent * 3.14159) * twistDir;
        vec2 lightDir = vec2(cos(u_lightAngle), sin(u_lightAngle));
        outLight = dot(dir, lightDir) * slope * u_specularIntensity * falloff * multiplier;
    }

    vec2 targetUv = center + newDelta;
    return (targetUv - uv) * falloff * multiplier;
}

void main() {
    float s1 = 0.0, l1 = 0.0;
    vec2 off1 = applyHole(v_texCoord, u_center, u_curve, u_effectMultiplier, 0.0, s1, l1);
    float s2 = 0.0, l2 = 0.0;
    vec2 off2 = applyHole(v_texCoord, u_exitCenter, u_curveExit, u_exitMultiplier, 1.0, s2, l2);

    vec2 finalUv = v_texCoord + off1 + off2;
    vec2 textureUv = clamp(u_textureOrigin + (finalUv * u_textureScale), 0.0, 1.0);
    vec4 finalColor = texture2D(u_image, vec2(textureUv.x, 1.0 - textureUv.y));

    float totalShadow = clamp(s1 + s2, 0.0, 1.0);
    float totalLight = l1 + l2;
    if (u_shadingEnabled > 0.5 && (u_effectMultiplier > 0.0 || u_exitMultiplier > 0.0)) {
        finalColor.rgb *= mix(1.0, 0.0, totalShadow);
        if (totalLight > 0.0) finalColor.rgb += totalLight;
        else finalColor.rgb += totalLight * 0.6;
    }

    if (u_objEnabled > 0.5 && u_objProgress < 2.5) {
        bool inExit = u_objProgress >= 1.0;
        float localProg = inExit ? (u_objProgress - 1.0) : u_objProgress;
        vec2 activeCenter = inExit ? u_exitCenter : u_center;
        vec2 activeCurve = inExit ? u_curveExit : u_curve;
        float twistDir = inExit ? -1.0 : 1.0;
        float z = inExit ? (-2.0 + localProg * (u_objHeight + 2.0)) : (u_objHeight - localProg * (u_objHeight + 2.0));
        vec2 objXY = activeCenter;
        float objScale = 0.06;

        if (z < 0.0) {
            float depthT = clamp(-z / 2.0, 0.0, 1.0);
            vec2 physicalCurve = activeCurve * pow(depthT, 2.0);
            physicalCurve.x /= u_aspectRatio;
            objXY += physicalCurve;
            objScale /= mix(1.0, u_zoom, depthT);
            objScale *= smoothstep(1.0, 0.8, depthT);
        }

        vec2 lDir2D = vec2(cos(u_lightAngle), sin(u_lightAngle));
        vec2 shadowOffset = -lDir2D * (max(0.0, z) * 0.15);
        vec2 shadowPos = objXY + shadowOffset;
        float distToShadow = length((v_texCoord - shadowPos) * vec2(u_aspectRatio, 1.0));
        float shadowRadius = objScale * (1.0 + max(0.0, z) * 1.5);
        if (z > -0.5 && distToShadow < shadowRadius * 2.5 && objScale > 0.001) {
            float shadowIntensity = smoothstep(shadowRadius * 2.5, shadowRadius * 0.1, distToShadow);
            shadowIntensity *= 0.6 * clamp(1.0 + z * 2.0, 0.0, 1.0);
            float shadowFragDist = length((v_texCoord - activeCenter) * vec2(u_aspectRatio, 1.0));
            float shadowLipFade = smoothstep(u_radius * 1.05, u_radius * 0.95, shadowFragDist);
            if (u_shadingEnabled > 0.5) finalColor.rgb *= (1.0 - shadowIntensity * shadowLipFade);
        }

        vec2 p = (v_texCoord - objXY) * vec2(u_aspectRatio, 1.0);
        if (length(p) < objScale * 2.0 && objScale > 0.001) {
            vec3 ro = vec3(p, 1.0);
            vec3 rd = vec3(0.0, 0.0, -1.0);
            float t = 0.0;
            bool hit = false;
            vec3 pObj = vec3(0.0);
            float angleX = u_currentSpinAngle;
            float angleY = u_currentSpinAngle * 1.3;
            float angleZ = u_currentSpinAngle * 0.7;
            if (z < 0.0) {
                float depthT = clamp(-z / 2.0, 0.0, 1.0);
                angleZ -= u_twist * twistDir * pow(depthT, 1.5);
            }
            mat2 rx = rot(angleX);
            mat2 ry = rot(angleY);
            mat2 rz = rot(angleZ);
            for (int i = 0; i < 35; i++) {
                vec3 pos = ro + rd * t;
                pos.z -= z;
                pos.yz = rx * pos.yz;
                pos.xz = ry * pos.xz;
                pos.xy = rz * pos.xy;
                float d = sdOctahedron(pos, objScale);
                if (d < 0.001) {
                    hit = true;
                    pObj = pos;
                    break;
                }
                t += d;
                if (t > 2.0) break;
            }
            if (hit) {
                vec2 e = vec2(0.001, 0.0);
                vec3 n = normalize(vec3(
                    sdOctahedron(pObj + e.xyy, objScale) - sdOctahedron(pObj - e.xyy, objScale),
                    sdOctahedron(pObj + e.yxy, objScale) - sdOctahedron(pObj - e.yxy, objScale),
                    sdOctahedron(pObj + e.yyx, objScale) - sdOctahedron(pObj - e.yyx, objScale)
                ));
                n.xy = n.xy * rot(-angleZ);
                n.xz = n.xz * rot(-angleY);
                n.yz = n.yz * rot(-angleX);
                vec3 lDir3D = normalize(vec3(cos(u_lightAngle), sin(u_lightAngle), 1.0));
                float diff = max(0.0, dot(n, lDir3D));
                vec3 halfDir = normalize(lDir3D + vec3(0.0, 0.0, 1.0));
                float spec = pow(max(0.0, dot(n, halfDir)), 32.0);
                vec3 objBaseColor = vec3(0.1, 0.9, 0.7);
                float objShadowFactor = 1.0;
                if (z < 0.0 && u_shadingEnabled > 0.5) {
                    objShadowFactor = mix(1.0, 1.0 - u_tunnelShadow, clamp(-z, 0.0, 1.0));
                }
                vec3 lColor = objBaseColor * diff * objShadowFactor;
                lColor += vec3(1.0) * spec * u_specularIntensity * objShadowFactor;
                lColor += objBaseColor * 0.15 * objShadowFactor;
                float alpha = 1.0;
                if (z < 0.0) {
                    float depthT = clamp(-z / 2.0, 0.0, 1.0);
                    float depthFade = 1.0 - clamp(-z / 1.5, 0.0, 1.0);
                    float wallFade = 1.0;
                    for (int j = 0; j <= 3; j++) {
                        float checkT = depthT * (float(j) / 4.0);
                        vec2 checkCurve = activeCurve * pow(checkT, 2.0);
                        checkCurve.x /= u_aspectRatio;
                        vec2 checkPos = activeCenter + checkCurve;
                        float checkR = u_radius * pow(1.0 - checkT, exp(u_strength)) / mix(1.0, u_zoom, checkT);
                        float dFrag = length((v_texCoord - checkPos) * vec2(u_aspectRatio, 1.0));
                        wallFade *= smoothstep(checkR * 1.15, checkR * 0.85, dFrag);
                    }
                    alpha = depthFade * wallFade;
                }
                finalColor.rgb = mix(finalColor.rgb, lColor, alpha);
            }
        }
    }

    if (u_flashAmount > 0.0 && u_flashIntensity > 0.0) {
        vec2 visualCenter = u_center - u_curve * vec2(1.0 / u_aspectRatio, 1.0);
        vec2 fVec = v_texCoord - visualCenter;
        fVec.x *= u_aspectRatio;
        float fr = length(fVec);
        float fa = atan(fVec.y, fVec.x);
        float spires = abs(sin(fa * 4.0 + u_time * 5.0)) * abs(cos(fa * 7.0 - u_time * 3.0));
        float flash = (0.01 / (fr + 0.001)) * (1.0 + spires * 1.5) * u_flashAmount;
        float flashFragDist = length((v_texCoord - u_center) * vec2(u_aspectRatio, 1.0));
        float flashLipFade = smoothstep(u_radius * 1.2, u_radius * 0.8, flashFragDist);
        finalColor.rgb += vec3(1.0, 0.95, 0.9) * flash * u_flashIntensity * flashLipFade;
    }

    gl_FragColor = finalColor;
}
`;

const WORMHOLE_PARTICLE_VERTEX_SHADER = `
precision highp float;
attribute vec4 a_params;
varying float v_alpha;
varying float v_twinkle;
uniform vec2 u_center;
uniform vec2 u_curve;
uniform float u_effectMultiplier;
uniform vec2 u_exitCenter;
uniform vec2 u_curveExit;
uniform float u_exitMultiplier;
uniform float u_radius;
uniform float u_strength;
uniform float u_twist;
uniform float u_zoom;
uniform float u_aspectRatio;
uniform float u_particlesEnabled;
uniform float u_particleDensity;
uniform float u_particleTime;
uniform float u_objEnabled;
uniform float u_objProgress;
uniform float u_objHeight;

void main() {
    float h1 = a_params.x;
    float h2 = a_params.y;
    float h3 = a_params.z;
    float h4 = a_params.w;
    bool isExitPart = h1 > 0.5;
    float activeMult = isExitPart ? u_exitMultiplier : u_effectMultiplier;
    if (activeMult <= 0.001 || u_particlesEnabled < 0.5 || h4 > u_particleDensity) {
        gl_PointSize = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    vec2 activeCenter = isExitPart ? u_exitCenter : u_center;
    vec2 activeCurve = isExitPart ? u_curveExit : u_curve;
    float twistDir = isExitPart ? -1.0 : 1.0;
    float cycleLength = 1.0 + h2 * 2.0;
    float localTime = fract(u_particleTime / cycleLength + h3);
    float tEntry = pow(localTime, 2.0);
    float tExit = pow(localTime, 0.5);
    float z = isExitPart ? (-2.0 + tExit * 2.5) : (0.2 - tEntry * 2.5);
    float depthT = clamp(-z / 2.0, 0.0, 1.0);
    float pPercent = 1.0 - depthT;
    float currentPZoom = mix(1.0, u_zoom, depthT);
    float distortionPower = exp(u_strength);
    float tunnelR = u_radius * pow(pPercent, distortionPower) / currentPZoom;
    float r = tunnelR * mix(0.9, 1.0, h2);
    if (z > 0.0) r = u_radius * (1.0 + z * 2.0) * mix(0.9, 1.0, h2);

    float theta = h1 * 6.28 + u_particleTime * (1.0 + h2 * 2.0) * sign(h3 - 0.5);
    vec2 physicalCurve = vec2(0.0);
    if (z < 0.0) {
        theta -= u_twist * twistDir * pow(depthT, 1.5);
        physicalCurve = activeCurve * pow(depthT, 2.0);
        physicalCurve.x /= u_aspectRatio;
    }

    vec2 screenPos = activeCenter + vec2(cos(theta) * r + physicalCurve.x, sin(theta) * r + physicalCurve.y);
    float pSize = mix(8.0, 20.0, h1);
    if (z < 0.0) pSize *= pPercent / currentPZoom;

    float alpha = smoothstep(0.2, 0.0, z);
    if (z < 0.0) {
        float wallFade = 1.0;
        for (int j = 0; j <= 2; j++) {
            float checkT = depthT * (float(j) / 3.0);
            vec2 checkCurve = activeCurve * pow(checkT, 2.0);
            checkCurve.x /= u_aspectRatio;
            vec2 checkPos = activeCenter + checkCurve;
            float checkR = u_radius * pow(1.0 - checkT, distortionPower) / mix(1.0, u_zoom, checkT);
            float dFrag = length((screenPos - checkPos) * vec2(u_aspectRatio, 1.0));
            wallFade *= smoothstep(checkR * 1.15, checkR * 0.85, dFrag);
        }
        alpha *= wallFade * (1.0 - smoothstep(0.8, 1.0, depthT));
    }
    alpha *= activeMult;

    if (u_objEnabled > 0.5 && u_objProgress < 2.5) {
        bool objInExit = u_objProgress >= 1.0;
        float objLocalProg = objInExit ? (u_objProgress - 1.0) : u_objProgress;
        vec2 objActiveCenter = objInExit ? u_exitCenter : u_center;
        vec2 objActiveCurve = objInExit ? u_curveExit : u_curve;
        float objZ = objInExit ? (-2.0 + objLocalProg * (u_objHeight + 2.0)) : (u_objHeight - objLocalProg * (u_objHeight + 2.0));
        vec2 objXY = objActiveCenter;
        float objScale = 0.06;
        if (objZ < 0.0) {
            float objDepthT = clamp(-objZ / 2.0, 0.0, 1.0);
            vec2 objPhysCurve = objActiveCurve * pow(objDepthT, 2.0);
            objPhysCurve.x /= u_aspectRatio;
            objXY += objPhysCurve;
            objScale /= mix(1.0, u_zoom, objDepthT);
            objScale *= smoothstep(1.0, 0.8, objDepthT);
        }
        if (z < objZ + objScale * 0.5) {
            float distToObj = length((screenPos - objXY) * vec2(u_aspectRatio, 1.0));
            if (distToObj < objScale * 1.8) {
                alpha *= smoothstep(objScale * 1.2, objScale * 1.8, distToObj);
            }
        }
    }

    if (alpha <= 0.01) {
        gl_PointSize = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    v_alpha = alpha;
    v_twinkle = 0.5 + 0.5 * sin(u_particleTime * (15.0 + h3 * 20.0) + h2 * 100.0);
    gl_PointSize = pSize;
    gl_Position = vec4(screenPos.x * 2.0 - 1.0, 1.0 - screenPos.y * 2.0, 0.0, 1.0);
}
`;

const WORMHOLE_PARTICLE_FRAGMENT_SHADER = `
precision highp float;
varying float v_alpha;
varying float v_twinkle;
void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;
    float core = exp(-pow(dist / 0.12, 2.0)) * 1.5;
    float halo = exp(-pow(dist / 0.35, 2.0)) * 0.5;
    float glow = core + halo;
    if (glow < 0.01) discard;
    vec3 pCol = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.95, 0.8), v_twinkle);
    gl_FragColor = vec4(pCol * glow * v_alpha * (v_twinkle * 0.8 + 0.4), 1.0);
}
`;

function createWormholeShaderOverlay() {
    let canvas = null;
    let gl = null;
    let resize = null;
    let quadProgram = null;
    let particleProgram = null;
    let quadBuffer = null;
    let particleBuffer = null;
    let texture = null;
    let textureSource = null;
    let particleCount = 1000;
    let failed = false;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
        }
        return shader;
    }

    function createProgram(vertexSource, fragmentSource) {
        const program = gl.createProgram();
        gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'shader link failed');
        }
        return program;
    }

    function uniform(program, name, value) {
        const location = gl.getUniformLocation(program, name);
        if (location == null) return;
        if (Array.isArray(value)) gl.uniform2f(location, value[0], value[1]);
        else gl.uniform1f(location, value);
    }

    function ensure() {
        if (failed) return null;
        if (canvas) return canvas;
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            failed = true;
            return null;
        }
        try {
            canvas = document.createElement('canvas');
            canvas.style.position = 'absolute';
            canvas.style.inset = '0';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '2';
            document.body.appendChild(canvas);
            gl = canvas.getContext('webgl', {
                alpha: true,
                antialias: true,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
            });
            if (!gl) throw new Error('webgl unavailable');

            quadProgram = createProgram(
                'attribute vec2 a_position; attribute vec2 a_texCoord; varying vec2 v_texCoord; void main(){ v_texCoord = a_texCoord; gl_Position = vec4(a_position, 0.0, 1.0); }',
                WORMHOLE_FRAGMENT_SHADER
            );
            particleProgram = createProgram(
                WORMHOLE_PARTICLE_VERTEX_SHADER,
                WORMHOLE_PARTICLE_FRAGMENT_SHADER
            );

            quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 0, 0,
                1, -1, 1, 0,
                -1, 1, 0, 1,
                -1, 1, 0, 1,
                1, -1, 1, 0,
                1, 1, 1, 1,
            ]), gl.STATIC_DRAW);

            const params = new Float32Array(particleCount * 4);
            let seed = 0x1234abcd;
            for (let index = 0; index < params.length; index += 1) {
                seed = (1664525 * seed + 1013904223) >>> 0;
                params[index] = seed / 0xffffffff;
            }
            particleBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, params, gl.STATIC_DRAW);

            texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            resize = () => {
                const dpr = window.devicePixelRatio || 1;
                canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
                canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
                canvas.style.width = `${window.innerWidth}px`;
                canvas.style.height = `${window.innerHeight}px`;
            };
            resize();
            window.addEventListener('resize', resize);
            return canvas;
        } catch (error) {
            console.warn('[sigil][fast-travel] wormhole shader disabled', error);
            failed = true;
            destroy();
            return null;
        }
    }

    function upload(image) {
        if (!image || image === textureSource) return;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        textureSource = image;
    }

    function clear() {
        if (!canvas && (failed || typeof document === 'undefined')) return;
        if (!ensure() || !gl) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    function draw(input) {
        if (!ensure() || !gl || !input?.capture?.image) return false;
        upload(input.capture.image);
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) resize?.();

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.disable(gl.BLEND);
        gl.useProgram(quadProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        const pos = gl.getAttribLocation(quadProgram, 'a_position');
        const tex = gl.getAttribLocation(quadProgram, 'a_texCoord');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(tex);
        gl.vertexAttribPointer(tex, 2, gl.FLOAT, false, 16, 8);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(gl.getUniformLocation(quadProgram, 'u_image'), 0);
        setSharedUniforms(quadProgram, input, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(particleProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
        const params = gl.getAttribLocation(particleProgram, 'a_params');
        gl.enableVertexAttribArray(params);
        gl.vertexAttribPointer(params, 4, gl.FLOAT, false, 0, 0);
        setSharedUniforms(particleProgram, input, width, height);
        gl.drawArrays(gl.POINTS, 0, particleCount);
        gl.disable(gl.BLEND);
        return true;
    }

    function setSharedUniforms(program, input, width, height) {
        const config = input.config;
        uniform(program, 'u_center', input.center);
        uniform(program, 'u_exitCenter', input.exitCenter);
        uniform(program, 'u_curve', input.curve);
        uniform(program, 'u_curveExit', input.curveExit);
        uniform(program, 'u_effectMultiplier', input.effectMultiplier);
        uniform(program, 'u_exitMultiplier', input.exitMultiplier);
        uniform(program, 'u_radius', input.radius);
        uniform(program, 'u_strength', config.strength);
        uniform(program, 'u_twist', config.twist);
        uniform(program, 'u_zoom', config.zoom);
        uniform(program, 'u_aspectRatio', width / height);
        uniform(program, 'u_shadingEnabled', config.shadingEnabled);
        uniform(program, 'u_tunnelShadow', config.tunnelShadow);
        uniform(program, 'u_specularIntensity', config.specularIntensity);
        uniform(program, 'u_lightAngle', config.lightAngle);
        uniform(program, 'u_objEnabled', config.objectEnabled);
        uniform(program, 'u_objProgress', input.objProgress);
        uniform(program, 'u_objHeight', config.objectHeight);
        uniform(program, 'u_currentSpinAngle', input.spinAngle);
        uniform(program, 'u_particlesEnabled', config.particlesEnabled ? 1 : 0);
        uniform(program, 'u_particleDensity', config.particleDensity);
        uniform(program, 'u_flashIntensity', config.flashIntensity);
        uniform(program, 'u_flashAmount', input.flashAmount);
        uniform(program, 'u_particleTime', input.particleTime);
        uniform(program, 'u_time', input.time);
        uniform(program, 'u_textureOrigin', input.textureOrigin ?? [0, 0]);
        uniform(program, 'u_textureScale', input.textureScale ?? [1, 1]);
    }

    function destroy() {
        if (resize) window.removeEventListener('resize', resize);
        resize = null;
        if (canvas) canvas.remove();
        canvas = null;
        gl = null;
    }

    return { mount: ensure, clear, draw, destroy };
}

function clonePoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, valid: point.valid ?? true };
}

function cloneCurve(curve) {
    if (!curve || typeof curve !== 'object') return null;
    return {
        x: Number(curve.x) || 0,
        y: Number(curve.y) || 0,
        amount: Number(curve.amount) || 0,
    };
}

function durationForDistance(from, to) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.max(120, Math.min(300, (dist / 5000) * 1000));
}

function snapshotLineTrailState(rendererState) {
    return {
        isOmegaEnabled: rendererState.isOmegaEnabled,
        omegaInterDimensional: rendererState.omegaInterDimensional,
        omegaGhostCount: rendererState.omegaGhostCount,
        omegaGhostDuration: rendererState.omegaGhostDuration,
        omegaGhostMode: rendererState.omegaGhostMode,
        omegaLagFactor: rendererState.omegaLagFactor,
        omegaScale: rendererState.omegaScale,
    };
}

function restoreLineTrailState(snapshot, rendererState) {
    if (!snapshot) return;
    rendererState.isOmegaEnabled = snapshot.isOmegaEnabled ?? false;
    rendererState.omegaInterDimensional = snapshot.omegaInterDimensional ?? false;
    rendererState.omegaGhostCount = snapshot.omegaGhostCount ?? 10;
    rendererState.omegaGhostDuration = snapshot.omegaGhostDuration ?? 2.0;
    rendererState.omegaGhostMode = snapshot.omegaGhostMode ?? 'fade';
    rendererState.omegaLagFactor = snapshot.omegaLagFactor ?? 0.05;
    rendererState.omegaScale = snapshot.omegaScale ?? 1.5;
}

function lineTravel(liveJs, displays, toX, toY) {
    const clamped = clampPointToDisplays(displays, toX, toY);
    const fromX = liveJs.avatarPos.valid ? liveJs.avatarPos.x : clamped.x;
    const fromY = liveJs.avatarPos.valid ? liveJs.avatarPos.y : clamped.y;
    const config = lineConfig(state);
    liveJs.travel = {
        effect: 'line',
        phase: 'line',
        fromX,
        fromY,
        toX: clamped.x,
        toY: clamped.y,
        from: { x: fromX, y: fromY, valid: true },
        to: { x: clamped.x, y: clamped.y, valid: true },
        startMs: performance.now(),
        durationMs: config.delayMs + config.durationMs,
        delayMs: config.delayMs,
        previousLineTrailState: snapshotLineTrailState(state),
    };
    if (config.trailEnabled) {
        state.isOmegaEnabled = true;
        state.omegaInterDimensional = true;
        state.omegaGhostCount = config.repeatCount;
        state.omegaGhostDuration = config.repeatDuration;
        state.omegaGhostMode = config.trailMode;
        state.omegaLagFactor = config.lagFactor;
        state.omegaScale = config.scale;
    } else {
        state.omegaInterDimensional = false;
    }
    resetOmegaInterdimensionalTrail(state.polyGroup?.position ?? null);
    return liveJs.travel;
}

function tickLineTravel(liveJs, onComplete) {
    const travel = liveJs.travel;
    if (!travel) return null;
    const stateForElapsed = lineTravelStateForElapsed(travel, performance.now() - travel.startMs);
    if (stateForElapsed.avatarPos?.valid) liveJs.avatarPos = { ...stateForElapsed.avatarPos };

    if (stateForElapsed.active) return stateForElapsed;

    const landed = { x: travel.toX, y: travel.toY, valid: true };
    liveJs.avatarPos = landed;
    liveJs.currentCursor = landed;
    liveJs.cursorTarget = landed;
    liveJs.travel = null;
    restoreLineTrailState(travel.previousLineTrailState, state);
    resetOmegaInterdimensionalTrail(state.polyGroup?.position ?? null);
    if (typeof onComplete === 'function') onComplete(landed);
    return { active: false, effect: 'line', phase: 'complete', avatarPos: landed, appScale: 1 };
}

function lineTravelStateForElapsed(travel, elapsedMs) {
    const delayMs = Math.max(0, Number(travel.delayMs) || 0);
    const motionMs = Math.max(1, travel.durationMs - delayMs);
    const progress = elapsedMs <= delayMs
        ? 0
        : clamp01((elapsedMs - delayMs) / motionMs);
    const eased = easeOutQuart(progress);
    const avatarPos = {
        x: travel.fromX + ((travel.toX - travel.fromX) * eased),
        y: travel.fromY + ((travel.toY - travel.fromY) * eased),
        valid: true,
    };
    return {
        active: progress < 1,
        effect: 'line',
        phase: progress < 1 ? 'line' : 'complete',
        avatarPos,
        appScale: progress < 1 ? undefined : 1,
    };
}

function pointAlongTravel(travel, t) {
    const eased = smoothstep(t);
    return {
        x: lerp(travel.from.x, travel.to.x, eased),
        y: lerp(travel.from.y, travel.to.y, eased),
        valid: true,
    };
}

function tunnelObjectProjection(base, curve, z, config) {
    if (!base?.valid) return { avatarPos: base, appScale: 0 };
    if (z >= 0) {
        return { avatarPos: { ...base }, appScale: 1 };
    }
    const depthT = clamp01(-z / 2);
    const bend = depthT * depthT;
    const zoom = lerp(1, Math.max(0.1, config?.zoom ?? 3.5), depthT);
    const lipFade = smoothstepRange(1.0, 0.8, depthT);
    const depthFade = 1 - clamp01(-z / 1.5);
    const appScale = clamp01((lipFade * depthFade) / zoom);
    return {
        avatarPos: {
            x: base.x + ((curve?.x ?? 0) * bend),
            y: base.y + ((curve?.y ?? 0) * bend),
            valid: true,
        },
        appScale,
    };
}

function tunnelObjectPose(base, curve, localProgress, isExit, config) {
    const objHeight = Math.max(0.05, config?.objectHeight ?? 0.8);
    const z = isExit
        ? (-2 + (localProgress * (objHeight + 2)))
        : (objHeight - (localProgress * (objHeight + 2)));
    return tunnelObjectProjection(base, curve, z, config);
}

function vectorBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
        dx,
        dy,
        length,
        ux: dx / length,
        uy: dy / length,
    };
}

function curveFor(from, to, radius) {
    const vector = vectorBetween(from, to);
    const amount = Math.min(radius * 1.1, vector.length * 0.18);
    return {
        x: vector.ux * amount,
        y: vector.uy * amount,
        amount,
    };
}

function wormholeRadius(rendererState) {
    return wormholeConfig(rendererState).radius;
}

function wormholeExitThreshold(rendererState) {
    return wormholeRadius(rendererState);
}

function displayId(display) {
    return display?.display_id ?? display?.id ?? display?.uuid ?? display?.display_uuid ?? null;
}

function rectFromDisplay(display) {
    return display?.bounds ?? display?.visibleBounds ?? display?.visible_bounds ?? null;
}

function nativeRectFromDisplay(display) {
    return display?.nativeBounds ?? display?.native_bounds ?? display?.bounds ?? display?.visibleBounds ?? display?.visible_bounds ?? null;
}

function rectWidth(rect) {
    return Number(rect?.w ?? rect?.width) || 0;
}

function rectHeight(rect) {
    return Number(rect?.h ?? rect?.height) || 0;
}

function normalizedRect(rect) {
    if (!rect) return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = rectWidth(rect);
    const h = rectHeight(rect);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function unionRects(rects = []) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const raw of rects) {
        const rect = normalizedRect(raw);
        if (!rect) continue;
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.w);
        maxY = Math.max(maxY, rect.y + rect.h);
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function nativeDesktopUnion(displays = []) {
    return unionRects(displays.map(nativeRectFromDisplay));
}

function desktopWorldUnion(displays = []) {
    return unionRects(displays.map(rectFromDisplay));
}

function pointDisplay(displays, point) {
    return findDisplayForPoint(displays, point?.x ?? 0, point?.y ?? 0) ?? displays?.[0] ?? null;
}

function displayStageRect(display, projectStagePoint) {
    const rect = rectFromDisplay(display);
    if (!rect) return null;
    const a = projectStagePoint({ x: rect.x, y: rect.y, valid: true });
    const b = projectStagePoint({ x: rect.x + rect.w, y: rect.y + rect.h, valid: true });
    if (!a?.valid || !b?.valid) return null;
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
    };
}

function rectOverlapArea(a, b) {
    if (!a || !b) return 0;
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function captureForCurrentSegment(container) {
    const viewport = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const displayCaptures = container?.captures?.displays
        ? Object.values(container.captures.displays)
        : [];
    const candidates = displayCaptures.length > 0
        ? displayCaptures
        : [container?.captures?.entry, container?.captures?.exit, container?.captures?.desktop].filter(Boolean);
    let best = null;
    let bestArea = 0;
    for (const capture of candidates) {
        const area = rectOverlapArea(capture.displayStageRect, viewport);
        if (area > bestArea) {
            best = capture;
            bestArea = area;
        }
    }
    return best ?? candidates[0] ?? null;
}

function currentSegmentDesktopRect(displays = [], projectStagePoint) {
    const viewport = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    let best = null;
    let bestArea = 0;
    for (const display of displays) {
        const stageRect = displayStageRect(display, projectStagePoint);
        const area = rectOverlapArea(stageRect, viewport);
        if (area > bestArea) {
            bestArea = area;
            best = normalizedRect(rectFromDisplay(display));
        }
    }
    return best ?? desktopWorldUnion(displays) ?? viewport;
}

function textureMappingForCapture(capture, displays, projectStagePoint) {
    const desktopRect = capture?.desktopWorldRect ?? desktopWorldUnion(displays);
    const segmentRect = currentSegmentDesktopRect(displays, projectStagePoint);
    if (!desktopRect || !segmentRect || rectWidth(desktopRect) <= 0 || rectHeight(desktopRect) <= 0) {
        return { textureOrigin: [0, 0], textureScale: [1, 1] };
    }
    return {
        textureOrigin: [
            (segmentRect.x - desktopRect.x) / desktopRect.w,
            (segmentRect.y - desktopRect.y) / desktopRect.h,
        ],
        textureScale: [
            segmentRect.w / desktopRect.w,
            segmentRect.h / desktopRect.h,
        ],
    };
}

function stageUv(point) {
    return [
        point.x / Math.max(1, window.innerWidth),
        point.y / Math.max(1, window.innerHeight),
    ];
}

function wormholeRadiusUv(config) {
    return Math.max(0.001, config.radius / Math.max(1, Math.min(window.innerWidth, window.innerHeight)));
}

function wormholeVectors(fromStage, toStage, radiusUv) {
    const center = stageUv(fromStage);
    const exitCenter = stageUv(toStage ?? fromStage);
    const aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    const realDx = (exitCenter[0] - center[0]) * aspect;
    const realDy = exitCenter[1] - center[1];
    const dist = Math.hypot(realDx, realDy);
    const footprint = radiusUv * 0.8;
    if (dist > footprint) {
        const exitMultiplier = Math.min(1, (dist - footprint) / 0.2);
        const curveMag = Math.min(1, dist * 1.5);
        const dirX = realDx / dist;
        const dirY = realDy / dist;
        const curve = [dirX * curveMag * 0.5, dirY * curveMag * 0.5];
        return {
            center,
            exitCenter,
            curve,
            curveExit: [-curve[0], -curve[1]],
            exitMultiplier,
        };
    }
    return {
        center,
        exitCenter,
        curve: [realDx * 2, realDy * 2],
        curveExit: [0, 0],
        exitMultiplier: 0,
    };
}

function captureLocalPoint(capture, point) {
    if (!capture?.image || !capture?.region || !point) return null;
    const native = desktopWorldToNativePoint(point, capture.displays ?? []) ?? point;
    const scaleX = capture.image.width / Math.max(1, Number(capture.region.width) || Number(capture.region.w) || 1);
    const scaleY = capture.image.height / Math.max(1, Number(capture.region.height) || Number(capture.region.h) || 1);
    return {
        x: (native.x - capture.region.x) * scaleX,
        y: (native.y - capture.region.y) * scaleY,
        scaleX,
        scaleY,
    };
}

function discardCaptures(container) {
    if (!container) return;
    container.captures = {};
    container.captureErrors = {};
    container.captureRequests = {};
}

function drawCaptureImagePatch(ctx, capture, sourcePoint, dx, dy, dw, dh, alpha = 1) {
    const local = captureLocalPoint(capture, sourcePoint);
    if (!capture?.image || !local) return false;
    const sw = Math.max(1, dw * local.scaleX);
    const sh = Math.max(1, dh * local.scaleY);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(
        capture.image,
        local.x - (sw / 2),
        local.y - (sh / 2),
        sw,
        sh,
        dx,
        dy,
        dw,
        dh
    );
    ctx.restore();
    return true;
}

function drawCaptureDisplay(ctx, capture, drawnDisplays) {
    if (!capture?.image || !capture?.displayStageRect) return false;
    const key = capture.displayId ?? `${capture.displayStageRect.x},${capture.displayStageRect.y}`;
    if (drawnDisplays?.has(key)) return true;
    drawnDisplays?.add(key);
    const rect = capture.displayStageRect;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(capture.image, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    return true;
}

function drawMirroredCaptureProof(ctx, capture) {
    if (!capture?.image) return false;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(window.innerWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(capture.image, 0, 0, window.innerWidth, window.innerHeight);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.74)';
    ctx.fillRect(10, 10, 310, 44);
    ctx.fillStyle = '#7cffd4';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`wormhole capture mirror display=${capture.displayId ?? '?'}`, 20, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${capture.image.width}x${capture.image.height}`, 20, 45);
    ctx.restore();
    return true;
}

function ensureCapturePixels(capture) {
    if (!capture?.image) return null;
    if (capture.pixelData) return capture.pixelData;
    const canvas = document.createElement('canvas');
    canvas.width = capture.image.naturalWidth || capture.image.width;
    canvas.height = capture.image.naturalHeight || capture.image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(capture.image, 0, 0, canvas.width, canvas.height);
    try {
        capture.pixelData = {
            width: canvas.width,
            height: canvas.height,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
        return capture.pixelData;
    } catch (error) {
        return null;
    }
}

function sampleCapturePixel(source, x, y) {
    const sx = clamp(x, 0, source.width - 1);
    const sy = clamp(y, 0, source.height - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const i00 = ((y0 * source.width) + x0) * 4;
    const i10 = ((y0 * source.width) + x1) * 4;
    const i01 = ((y1 * source.width) + x0) * 4;
    const i11 = ((y1 * source.width) + x1) * 4;
    const out = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
        const top = lerp(source.data[i00 + channel], source.data[i10 + channel], tx);
        const bottom = lerp(source.data[i01 + channel], source.data[i11 + channel], tx);
        out[channel] = lerp(top, bottom, ty);
    }
    return out;
}

function drawPinchDistortionPatch(ctx, capture, center, sourcePoint, radius, depth, curve, twistDirection = 1, config = wormholeConfig(state)) {
    const local = captureLocalPoint(capture, sourcePoint);
    const source = ensureCapturePixels(capture);
    if (!local || !source) return false;

    const patchRadius = Math.ceil(radius * 1.22);
    const size = Math.max(32, patchRadius * 2);
    const patch = capture._wormholePatch ?? document.createElement('canvas');
    capture._wormholePatch = patch;
    if (patch.width !== size || patch.height !== size) {
        patch.width = size;
        patch.height = size;
    }
    const patchCtx = patch.getContext('2d', { willReadFrequently: true });
    if (!patchCtx) return false;

    const image = patchCtx.createImageData(size, size);
    const out = image.data;
    const strength = config.strength;
    const distortionPower = Math.exp(strength);
    const twist = config.twist * depth * twistDirection;
    const zoom = 1 + ((config.zoom - 1) * depth);
    const curveScale = 0.95 * depth;
    const lightDir = {
        x: Math.cos(config.lightAngle),
        y: Math.sin(config.lightAngle),
    };

    for (let py = 0; py < size; py += 1) {
        const dy = py - patchRadius;
        for (let px = 0; px < size; px += 1) {
            const dx = px - patchRadius;
            const dist = Math.hypot(dx, dy);
            const percent = dist / radius;
            const alphaEdge = smoothstepRange(1.12, 0.84, percent);
            if (alphaEdge <= 0.001) continue;

            const falloff = smoothstepRange(1.0, 0.7, percent);
            const pinchedDistance = Math.pow(Math.min(percent, 1.4), distortionPower) * radius;
            const currentZoom = lerp(1, zoom, falloff * Math.max(0, 1 - percent));
            const sourceDistance = pinchedDistance / currentZoom;
            const angle = Math.atan2(dy, dx) + (twist * Math.pow(Math.max(0, 1 - percent), 1.5) * falloff);
            const curveOffset = Math.pow(Math.max(0, 1 - percent), 2) * falloff * curveScale;
            const sx = local.x + ((Math.cos(angle) * sourceDistance) + (curve.x * curveOffset)) * local.scaleX;
            const sy = local.y + ((Math.sin(angle) * sourceDistance) + (curve.y * curveOffset)) * local.scaleY;
            const sample = sampleCapturePixel(source, sx, sy);

            const dirX = Math.cos(angle);
            const dirY = Math.sin(angle);
            const shadow = config.tunnelShadow * depth * Math.pow(Math.max(0, 1 - percent), 2) * falloff;
            const slope = -strength * Math.sin(percent * Math.PI) * twistDirection;
            const highlight = Math.max(-0.28, (dirX * lightDir.x + dirY * lightDir.y) * slope)
                * config.specularIntensity
                * depth
                * falloff;
            const alpha = Math.round(255 * alphaEdge * (0.22 + (0.78 * depth)));
            const idx = ((py * size) + px) * 4;
            out[idx] = Math.max(0, Math.min(255, (sample[0] * (1 - shadow)) + (255 * highlight)));
            out[idx + 1] = Math.max(0, Math.min(255, (sample[1] * (1 - shadow)) + (255 * highlight)));
            out[idx + 2] = Math.max(0, Math.min(255, (sample[2] * (1 - shadow)) + (255 * highlight)));
            out[idx + 3] = alpha;
        }
    }

    patchCtx.putImageData(image, 0, 0);
    ctx.drawImage(patch, center.x - patchRadius, center.y - patchRadius, size, size);
    return true;
}

function drawCurvedPatch(ctx, capture, center, sourcePoint, radius, depth, curve, twistDirection = 1, config = wormholeConfig(state)) {
    if (drawPinchDistortionPatch(ctx, capture, center, sourcePoint, radius, depth, curve, twistDirection, config)) return;

    const rings = 11;
    ctx.save();
    ctx.globalAlpha = 0.25 + (0.18 * depth);
    drawCaptureImagePatch(ctx, capture, sourcePoint, center.x - radius, center.y - radius, radius * 2, radius * 2, 1);
    ctx.restore();

    for (let index = rings; index >= 1; index -= 1) {
        const t = index / rings;
        const ringRadius = radius * t;
        const sink = (1 - t) * depth;
        const cx = center.x + (curve.x * sink);
        const cy = center.y + (curve.y * sink);
        const compression = Math.max(0.16, 1 - (depth * (0.72 - (0.25 * t))));
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(twistDirection * depth * (1 - t) * config.twist * 0.28);
        ctx.scale(compression, Math.max(0.14, compression * 0.82));
        ctx.globalAlpha = 0.04 + (t * 0.1);
        if (!drawCaptureImagePatch(ctx, capture, sourcePoint, -radius, -radius, radius * 2, radius * 2, 1)) {
            const fallback = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
            fallback.addColorStop(0, 'rgba(255,255,255,0.16)');
            fallback.addColorStop(0.35, 'rgba(40,170,255,0.08)');
            fallback.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fallback;
            ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        }
        ctx.restore();
    }
}

function drawTunnelParticles(ctx, {
    tunnel,
    radius,
    depth,
    curve,
    mode,
    time,
    accentA,
    accentB,
    config,
}) {
    if (!config?.particlesEnabled) return;
    const particleCount = mode === 'exit' ? 25 : 25;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < particleCount; index += 1) {
        const seedA = ((index * 0.61803398875) % 1);
        const seedB = ((index * 0.75487766625) % 1);
        const speed = mode === 'exit' ? 0.46 + (seedB * 0.24) : 0.34 + (seedB * 0.22);
        const cycle = ((time * speed) + seedA) % 1;
        const eased = easeOutQuart(cycle);
        const angle = (Math.PI * 2 * seedA) + (time * (mode === 'exit' ? 0.35 : 0.7) * (seedB > 0.5 ? 1 : -1));
        const radial = mode === 'exit'
            ? 0.14 + (eased * 1.22)
            : 1.08 - (eased * 0.96);
        const curveT = mode === 'exit'
            ? Math.max(0, 1 - (cycle * 0.9))
            : cycle * cycle;
        const px = tunnel.x
            + (Math.cos(angle) * radius * radial * depth)
            + (curve.x * depth * curveT * 0.55);
        const py = tunnel.y
            + (Math.sin(angle) * radius * radial * depth)
            + (curve.y * depth * curveT * 0.55);
        const particleRadius = ((mode === 'exit' ? 1.2 : 1.4) + ((index % 4) * 0.6)) * Math.max(0.75, depth);
        const alpha = mode === 'exit'
            ? depth * smoothstep(cycle / 0.16) * (1 - smoothstep((cycle - 0.52) / 0.48))
            : depth * smoothstep(cycle / 0.22) * (1 - smoothstep((cycle - 0.72) / 0.28));

        if (alpha <= 0.002) continue;

        if (mode === 'exit') {
            const previousRadial = Math.max(0.08, radial - 0.14);
            const sx = tunnel.x
                + (Math.cos(angle) * radius * previousRadial * depth)
                + (curve.x * depth * Math.min(1, curveT + 0.08) * 0.55);
            const sy = tunnel.y
                + (Math.sin(angle) * radius * previousRadial * depth)
                + (curve.y * depth * Math.min(1, curveT + 0.08) * 0.55);
            const streak = ctx.createLinearGradient(sx, sy, px, py);
            streak.addColorStop(0, rgba('#ffffff', 0));
            streak.addColorStop(0.45, rgba(accentB, alpha * 0.18));
            streak.addColorStop(1, rgba('#ffffff', alpha * 0.32));
            ctx.strokeStyle = streak;
            ctx.lineWidth = Math.max(0.8, particleRadius * 0.8);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(px, py);
            ctx.stroke();
        }

        const particle = ctx.createRadialGradient(px, py, 0, px, py, particleRadius * 5.2);
        particle.addColorStop(0, rgba('#ffffff', 0.86 * alpha));
        particle.addColorStop(0.34, rgba(mode === 'exit' ? accentB : accentA, 0.34 * alpha));
        particle.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = particle;
        ctx.beginPath();
        ctx.arc(px, py, particleRadius * 5.2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawTunnel(ctx, tunnel, other, radius, open, options) {
    if (!tunnel || open <= 0.001) return;
    const faceColors = state.colors?.face ?? ['#ffffff', '#88ccff'];
    const accentA = faceColors[0];
    const accentB = faceColors[1];
    const vector = other ? vectorBetween(tunnel, other) : { ux: 1, uy: 0, length: 0 };
    const curve = other ? curveFor(tunnel, other, radius) : { x: 0, y: 0 };
    const depth = smoothstep(open);
    const twistDirection = options?.twistDirection ?? 1;
    const time = options?.time ?? 0;
    const capture = options?.capture;
    const sourcePoint = options?.sourcePoint;
    const particleFlow = options?.particleFlow ?? 'entry';
    const config = options?.config ?? wormholeConfig(state);

    drawCurvedPatch(ctx, capture, tunnel, sourcePoint, radius, depth, curve, twistDirection, config);

    const well = ctx.createRadialGradient(tunnel.x, tunnel.y, radius * 0.04, tunnel.x, tunnel.y, radius * 1.35);
    well.addColorStop(0, `rgba(255,255,255,${0.18 * depth * config.whitePoint})`);
    well.addColorStop(0.18, `rgba(5, 10, 22, ${0.18 + (0.30 * depth * config.tunnelShadow)})`);
    well.addColorStop(0.62, `rgba(3, 5, 14, ${0.20 + (0.42 * depth * config.tunnelShadow)})`);
    well.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(tunnel.x, tunnel.y, radius * (0.62 + (0.58 * depth)), 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(tunnel.x, tunnel.y);
    ctx.rotate(Math.atan2(vector.uy, vector.ux));
    for (let index = 0; index < 8; index += 1) {
        const t = index / 8;
        const ringX = curve.amount * depth * t * 0.92;
        const ringRadius = radius * (1 - (t * 0.72)) * (0.52 + (0.48 * depth));
        ctx.strokeStyle = rgba(index % 2 ? accentA : accentB, (0.18 + (0.28 * (1 - t))) * depth);
        ctx.lineWidth = Math.max(0.8, 2.2 * (1 - t));
        ctx.beginPath();
        ctx.ellipse(ringX, 0, ringRadius, ringRadius * (0.38 + (0.22 * t)), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    drawTunnelParticles(ctx, { tunnel, radius, depth, curve, mode: particleFlow, time, accentA, accentB, config });

    const burst = depth * (options?.burst ?? 0.65) * config.starburst;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let index = 0; index < 12; index += 1) {
        const angle = (Math.PI * 2 * index / 12) + (time * 0.2);
        const inner = radius * 0.05;
        const outer = radius * (0.45 + (0.25 * burst) + ((index % 3) * 0.04));
        const gradient = ctx.createLinearGradient(
            tunnel.x + (Math.cos(angle) * inner),
            tunnel.y + (Math.sin(angle) * inner),
            tunnel.x + (Math.cos(angle) * outer),
            tunnel.y + (Math.sin(angle) * outer)
        );
        gradient.addColorStop(0, rgba('#ffffff', 0.42 * burst));
        gradient.addColorStop(0.45, rgba(accentB, 0.2 * burst));
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1 + ((index % 3) * 0.5);
        ctx.beginPath();
        ctx.moveTo(tunnel.x + (Math.cos(angle) * inner), tunnel.y + (Math.sin(angle) * inner));
        ctx.lineTo(tunnel.x + (Math.cos(angle) * outer), tunnel.y + (Math.sin(angle) * outer));
        ctx.stroke();
    }
    ctx.restore();

    const singularity = ctx.createRadialGradient(tunnel.x, tunnel.y, 0, tunnel.x, tunnel.y, radius * 0.22);
    singularity.addColorStop(0, rgba('#ffffff', 0.9 * depth * config.whitePoint));
    singularity.addColorStop(0.35, rgba(accentA, 0.38 * depth));
    singularity.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = singularity;
    ctx.beginPath();
    ctx.arc(tunnel.x, tunnel.y, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();

    if (config.lensFlare > 0 && other) {
        const flareVector = vectorBetween(other, tunnel);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let index = 0; index < 3; index += 1) {
            const scale = 0.35 + (index * 0.28);
            const px = tunnel.x + flareVector.ux * radius * scale;
            const py = tunnel.y + flareVector.uy * radius * scale;
            const flareRadius = radius * (0.14 + index * 0.04);
            const flare = ctx.createRadialGradient(px, py, 0, px, py, flareRadius);
            flare.addColorStop(0, rgba(index % 2 ? accentA : accentB, 0.20 * depth * config.lensFlare));
            flare.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = flare;
            ctx.beginPath();
            ctx.arc(px, py, flareRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawTravelFlash(ctx, travel, elapsed, config, projectStagePoint) {
    if (!travel || config.flashIntensity <= 0) return;
    const transitStart = travel.entryMs;
    const transitMid = transitStart + (travel.transitMs * 0.5);
    const pulseWidth = Math.max(90, travel.transitMs * 0.22);
    const amount = Math.max(0, 1 - (Math.abs(elapsed - transitMid) / pulseWidth));
    if (amount <= 0) return;
    const center = projectStagePoint(pointAlongTravel(travel, 0.5));
    if (!center?.valid) return;
    const radius = travel.captureRadius * (0.42 + amount * 1.1);
    const faceColors = state.colors?.face ?? ['#ffffff', '#88ccff'];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    glow.addColorStop(0, rgba('#fff8e8', 0.62 * amount * config.flashIntensity));
    glow.addColorStop(0.28, rgba(faceColors[0], 0.20 * amount * config.flashIntensity));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    for (let index = 0; index < 14; index += 1) {
        const angle = (Math.PI * 2 * index / 14) + elapsed * 0.006;
        const inner = radius * 0.08;
        const outer = radius * (0.56 + ((index % 4) * 0.08));
        const ray = ctx.createLinearGradient(
            center.x + Math.cos(angle) * inner,
            center.y + Math.sin(angle) * inner,
            center.x + Math.cos(angle) * outer,
            center.y + Math.sin(angle) * outer
        );
        ray.addColorStop(0, rgba('#ffffff', 0.28 * amount * config.flashIntensity));
        ray.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = ray;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
        ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
        ctx.stroke();
    }
    ctx.restore();
}

export function startFastTravel(liveJs, displays, toX, toY) {
    return lineTravel(liveJs, displays, toX, toY);
}

export function tickFastTravel(liveJs, onComplete) {
    return tickLineTravel(liveJs, onComplete);
}

export function createFastTravelController({
    host,
    state: rendererState,
    liveJs,
    projectStagePoint,
    getExcludedCanvasIds,
    canCaptureDisplayImages = () => true,
}) {
    const overlay = createCanvasOverlay();
    const wormholeOverlay = createWormholeShaderOverlay();
    let gesture = null;

    function record(stage, extra = {}) {
        const entry = { ts: Date.now(), stage, ...extra };
        if (!Array.isArray(liveJs.fastTravelEvents)) liveJs.fastTravelEvents = [];
        liveJs.fastTravelEvents.push(entry);
        if (liveJs.fastTravelEvents.length > 80) liveJs.fastTravelEvents.shift();
        console.debug('[sigil][fast-travel]', stage, entry);
    }

    function effect() {
        return normalizeFastTravelEffect(rendererState.transitionFastTravelEffect);
    }

    function captureForPoint(container, point, slot) {
        const display = pointDisplay(liveJs.displays, point);
        const id = displayId(display);
        const existing = container.captures?.[slot];
        if (existing && existing.displayId === id) return existing;
        return null;
    }

    async function requestDisplayCapture(container, display) {
        if (!container || !display) return;
        container.captures = container.captures ?? {};
        container.captureErrors = container.captureErrors ?? {};
        container.captures.displays = container.captures.displays ?? {};
        const nativeBounds = normalizedRect(nativeRectFromDisplay(display));
        const desktopBounds = normalizedRect(rectFromDisplay(display));
        if (!nativeBounds || !desktopBounds) return;
        const displayKey = String(displayId(display) ?? `${desktopBounds.x},${desktopBounds.y}`);
        const slot = `display:${displayKey}`;
        const id = `${slot}:${Math.round(nativeBounds.x)},${Math.round(nativeBounds.y)},${Math.round(nativeBounds.w)},${Math.round(nativeBounds.h)}`;
        if (container.captureRequests?.[slot] === id || container.captures.displays[displayKey]?.captureId === id) return;
        container.captureRequests = container.captureRequests ?? {};
        container.captureRequests[slot] = id;
        const region = {
            x: nativeBounds.x,
            y: nativeBounds.y,
            width: nativeBounds.w,
            height: nativeBounds.h,
        };
        try {
            const result = await host.captureRegion(region, {
                format: 'jpg',
                quality: 'med',
                timeoutMs: 900,
                excludeCanvasIds: getExcludedCanvasIds(),
            });
            const image = await loadImage(result);
            if (
                container !== liveJs.travel
                && container !== gesture
                && container.captures !== liveJs.travel?.captures
            ) return;
            container.captures.displays[displayKey] = {
                image,
                region: result.region ?? region,
                captureId: id,
                displayId: displayKey,
                displayBounds: desktopBounds,
                desktopWorldRect: desktopBounds,
                displayStageRect: displayStageRect(display, projectStagePoint),
                displays: liveJs.displays,
            };
            record('wormhole.capture.display', {
                ok: true,
                display: displayKey,
                scope: 'display',
                width: Math.round(region.width),
                height: Math.round(region.height),
            });
        } catch (error) {
            if (container !== liveJs.travel && container !== gesture) return;
            container.captureErrors[slot] = String(error);
            record('wormhole.capture.display', { ok: false, display: displayKey, scope: 'display', error: String(error) });
        } finally {
            if (container.captureRequests) delete container.captureRequests[slot];
        }
    }

    function requestAllDisplayCaptures(container) {
        if (!container || !Array.isArray(liveJs.displays)) return;
        if (!canCaptureDisplayImages()) return;
        if (!wormholeConfig(rendererState).captureEnabled) return;
        if (container.captureAllAttempted) return;
        container.captureAllAttempted = true;
        container.captureBatchPromise = (async () => {
            for (const display of liveJs.displays) {
                await requestDisplayCapture(container, display);
            }
        })();
    }

    function beginGesture(origin) {
        if (effect() !== 'wormhole' || !origin?.valid) return;
        gesture = {
            effect: 'wormhole',
            origin: { x: origin.x, y: origin.y, valid: true },
            pointer: { x: origin.x, y: origin.y, valid: true },
            openedAt: performance.now(),
            captureRadius: wormholeRadius(rendererState),
            captures: {},
            captureErrors: {},
            captureRequests: {},
            captureAllAttempted: false,
        };
        record('wormhole.entry.created', {
            x: Math.round(origin.x),
            y: Math.round(origin.y),
        });
        requestAllDisplayCaptures(gesture);
    }

    function updateGesture(point) {
        if (!gesture || !point) return;
        gesture.pointer = { x: point.x, y: point.y, valid: true };
        const dist = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y);
        if (!gesture.exitCreated && dist > wormholeExitThreshold(rendererState)) {
            gesture.exitCreated = true;
            record('wormhole.exit.created', {
                x: Math.round(point.x),
                y: Math.round(point.y),
            });
        }
        if (gesture.exitCreated) requestAllDisplayCaptures(gesture);
    }

    function clearGesture(reason = 'clear') {
        if (gesture) record('wormhole.gesture.clear', { reason });
        discardCaptures(gesture);
        gesture = null;
        if (!liveJs.travel) {
            overlay.clear();
            wormholeOverlay.clear();
        }
    }

    function exportSnapshot() {
        const now = performance.now();
        const travel = liveJs.travel;
        const radius = wormholeRadius(rendererState);
        const gestureDistance = gesture?.origin && gesture?.pointer
            ? Math.hypot(gesture.pointer.x - gesture.origin.x, gesture.pointer.y - gesture.origin.y)
            : 0;
        return {
            gesture: gesture ? {
                effect: gesture.effect,
                origin: clonePoint(gesture.origin),
                pointer: clonePoint(gesture.pointer),
                openedElapsedMs: Math.max(0, now - gesture.openedAt),
                exitCreated: !!gesture.exitCreated,
                distance: gestureDistance,
                exitThreshold: wormholeExitThreshold(rendererState),
                entryCurve: cloneCurve(curveFor(gesture.origin, gesture.pointer, radius)),
                exitCurve: cloneCurve(curveFor(gesture.pointer, gesture.origin, radius)),
                captures: {
                    displays: Object.keys(gesture.captures?.displays ?? {}),
                },
            } : null,
            travel: travel ? {
                effect: travel.effect,
                phase: travel.phase,
                fromX: travel.fromX,
                fromY: travel.fromY,
                toX: travel.toX,
                toY: travel.toY,
                from: clonePoint(travel.from) ?? { x: travel.fromX, y: travel.fromY, valid: true },
                to: clonePoint(travel.to) ?? { x: travel.toX, y: travel.toY, valid: true },
                pointer: clonePoint(travel.pointer),
                elapsedMs: Math.max(0, now - travel.startMs),
                durationMs: travel.durationMs,
                delayMs: travel.delayMs,
                entryMs: travel.entryMs,
                transitMs: travel.transitMs,
                exitMs: travel.exitMs,
                previousLineTrailState: travel.previousLineTrailState,
                previousOmegaInterDimensional: travel.previousOmegaInterDimensional,
                captureRadius: travel.captureRadius,
                entryCurve: cloneCurve(travel.entryCurve),
                exitCurve: cloneCurve(travel.exitCurve),
            } : null,
        };
    }

    function applySnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        const now = performance.now();
        if (snapshot.gesture) {
            gesture = {
                effect: snapshot.gesture.effect,
                origin: clonePoint(snapshot.gesture.origin),
                pointer: clonePoint(snapshot.gesture.pointer),
                openedAt: now - Math.max(0, Number(snapshot.gesture.openedElapsedMs) || 0),
                exitCreated: !!snapshot.gesture.exitCreated,
            };
        } else {
            gesture = null;
        }

        if (snapshot.travel) {
            const travel = snapshot.travel;
            const from = clonePoint(travel.from) ?? { x: Number(travel.fromX) || 0, y: Number(travel.fromY) || 0, valid: true };
            const to = clonePoint(travel.to) ?? { x: Number(travel.toX) || from.x, y: Number(travel.toY) || from.y, valid: true };
            liveJs.travel = {
                effect: travel.effect,
                phase: travel.phase,
                fromX: Number(travel.fromX) || from.x,
                fromY: Number(travel.fromY) || from.y,
                toX: Number(travel.toX) || to.x,
                toY: Number(travel.toY) || to.y,
                from,
                to,
                pointer: clonePoint(travel.pointer) ?? to,
                startMs: now - Math.max(0, Number(travel.elapsedMs) || 0),
                durationMs: Number(travel.durationMs) || durationForDistance(from, to),
                delayMs: Number(travel.delayMs) || 0,
                entryMs: Number(travel.entryMs) || 160,
                transitMs: Number(travel.transitMs) || 80,
                exitMs: Number(travel.exitMs) || 220,
                previousLineTrailState: travel.previousLineTrailState,
                previousOmegaInterDimensional: !!travel.previousOmegaInterDimensional,
                captureRadius: Number(travel.captureRadius) || wormholeRadius(rendererState),
                entryCurve: cloneCurve(travel.entryCurve) ?? curveFor(from, to, Number(travel.captureRadius) || wormholeRadius(rendererState)),
                exitCurve: cloneCurve(travel.exitCurve) ?? curveFor(to, from, Number(travel.captureRadius) || wormholeRadius(rendererState)),
                captures: {},
                captureErrors: {},
            };
        } else {
            liveJs.travel = null;
            if (!gesture) overlay.clear();
        }
    }

    function start(toX, toY, options = {}) {
        const currentEffect = effect();
        if (currentEffect !== 'wormhole') {
            clearGesture('line-start');
            return lineTravel(liveJs, liveJs.displays, toX, toY);
        }

        const clamped = clampPointToDisplays(liveJs.displays, toX, toY);
        const from = liveJs.avatarPos.valid
            ? { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y, valid: true }
            : { x: clamped.x, y: clamped.y, valid: true };
        const to = { x: clamped.x, y: clamped.y, valid: true };
        const config = wormholeConfig(rendererState);
        const radius = config.radius;
        const openingMs = config.openingMs;
        const totalObjectMs = config.objectTravelMs * 2;
        const releaseOpen = gesture
            ? Math.max(0.35, easeInOutQuad((performance.now() - gesture.openedAt) / openingMs))
            : 1;
        const releaseVectors = gesture
            ? wormholeVectors(
                projectStagePoint(gesture.origin),
                projectStagePoint(gesture.pointer),
                wormholeRadiusUv(config)
            )
            : null;
        const releaseExit = gesture?.exitCreated
            ? Math.max(0.35, (releaseVectors?.exitMultiplier ?? 1) * releaseOpen)
            : 1;
        const travel = {
            effect: 'wormhole',
            phase: 'transit',
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
            previousOmegaEnabled: state.isOmegaEnabled,
            from,
            to,
            pointer: options.pointer ?? to,
            startMs: performance.now(),
            durationMs: totalObjectMs + config.closeMs,
            entryMs: 0,
            transitMs: totalObjectMs,
            exitMs: config.closeMs,
            closeStartMultiplier: releaseOpen,
            closeStartExitMultiplier: releaseExit,
            captureRadius: radius,
            entryCurve: curveFor(from, to, radius),
            exitCurve: curveFor(to, from, radius),
            previousOmegaInterDimensional: state.omegaInterDimensional,
            captures: gesture?.captures ?? { displays: {} },
            captureErrors: gesture?.captureErrors ?? {},
            captureRequests: gesture?.captureRequests ?? {},
            captureAllAttempted: gesture?.captureAllAttempted ?? false,
        };
        liveJs.travel = travel;
        state.omegaInterDimensional = false;
        resetOmegaInterdimensionalTrail(null);
        record('wormhole.release', {
            from: { x: Math.round(from.x), y: Math.round(from.y) },
            to: { x: Math.round(to.x), y: Math.round(to.y) },
        });
        requestAllDisplayCaptures(travel);
        gesture = null;
        return travel;
    }

    function tick(dt, onComplete) {
        const travel = liveJs.travel;
        if (!travel) return null;
        if (travel.effect !== 'wormhole') return tickLineTravel(liveJs, onComplete);

        const elapsed = performance.now() - travel.startMs;
        const stateForElapsed = wormholeTravelStateForElapsed(travel, elapsed);
        const progress = clamp01(elapsed / travel.durationMs);

        if (travel.phase !== stateForElapsed.phase) {
            travel.phase = stateForElapsed.phase;
            record(`wormhole.phase.${stateForElapsed.phase}`, { progress: Number(progress.toFixed(3)) });
        }

        if (stateForElapsed.active) return stateForElapsed;

        const landed = { ...travel.to };
        liveJs.avatarPos = landed;
        liveJs.currentCursor = landed;
        liveJs.cursorTarget = landed;
        discardCaptures(travel);
        liveJs.travel = null;
        state.isOmegaEnabled = travel.previousOmegaEnabled ?? false;
        state.omegaInterDimensional = travel.previousOmegaInterDimensional ?? false;
        overlay.clear();
        wormholeOverlay.clear();
        record('wormhole.complete', {
            x: Math.round(landed.x),
            y: Math.round(landed.y),
        });
        if (typeof onComplete === 'function') onComplete(landed);
        return { active: false, effect: 'wormhole', phase: 'complete', appScale: 1, avatarPos: landed };
    }

    function wormholeTravelStateForElapsed(travel, elapsed) {
        const transitEnd = travel.entryMs + travel.transitMs;
        const progress = clamp01(elapsed / travel.durationMs);
        const from = travel.from ?? { x: travel.fromX, y: travel.fromY, valid: true };
        const to = travel.to ?? { x: travel.toX, y: travel.toY, valid: true };
        const config = wormholeConfig(rendererState);
        const objectMs = Math.max(1, Number(travel.transitMs) || (config.objectTravelMs * 2));
        const singleTunnelMs = Math.max(1, objectMs / 2);

        let appScale = rendererState.appScale;
        let renderAvatarPos = from;
        let phase = 'transit';

        if (elapsed <= transitEnd) {
            phase = 'transit';
            const objectProgress = Math.max(0, elapsed - travel.entryMs) / singleTunnelMs;
            if (objectProgress < 1) {
                const pose = tunnelObjectPose(from, travel.entryCurve, clamp01(objectProgress), false, config);
                appScale = pose.appScale;
                renderAvatarPos = pose.avatarPos;
            } else if (objectProgress < 2) {
                const pose = tunnelObjectPose(to, travel.exitCurve, clamp01(objectProgress - 1), true, config);
                appScale = pose.appScale;
                renderAvatarPos = pose.avatarPos;
            } else {
                appScale = 1;
                renderAvatarPos = { ...to };
            }
        } else {
            phase = 'exit';
            appScale = 1;
            renderAvatarPos = { ...to };
        }

        if (progress < 1) {
            return { active: true, effect: 'wormhole', phase, appScale, avatarPos: renderAvatarPos };
        }

        return { active: false, effect: 'wormhole', phase: 'complete', appScale: 1, avatarPos: { ...travel.to } };
    }

    function preview() {
        const travel = liveJs.travel;
        if (!travel) return null;
        const elapsed = performance.now() - travel.startMs;
        const stateForElapsed = travel.effect === 'wormhole'
            ? wormholeTravelStateForElapsed(travel, elapsed)
            : lineTravelStateForElapsed(travel, elapsed);
        travel.phase = stateForElapsed.phase;
        return stateForElapsed;
    }

    function shaderInputForGesture(nowMs, nowSeconds, config) {
        if (!gesture) return null;
        const origin = projectStagePoint(gesture.origin);
        const pointer = projectStagePoint(gesture.pointer);
        if (!origin?.valid || !pointer?.valid) return null;
        const capture = captureForCurrentSegment(gesture);
        const mapping = textureMappingForCapture(capture, liveJs.displays, projectStagePoint);
        const open = easeInOutQuad((nowMs - gesture.openedAt) / config.openingMs);
        const radiusUv = wormholeRadiusUv(config);
        const vectors = wormholeVectors(origin, pointer, radiusUv);
        const active = Math.max(open, gesture.exitCreated ? vectors.exitMultiplier * open : 0);
        return {
            capture,
            textureOrigin: mapping.textureOrigin,
            textureScale: mapping.textureScale,
            center: vectors.center,
            exitCenter: vectors.exitCenter,
            curve: vectors.curve,
            curveExit: vectors.curveExit,
            effectMultiplier: open,
            exitMultiplier: gesture.exitCreated ? vectors.exitMultiplier * open : 0,
            radius: Math.max(0.001, radiusUv * (0.01 + (0.99 * active))),
            objProgress: 0,
            flashAmount: 0,
            spinAngle: ((nowMs - gesture.openedAt) / 1000) * config.objectSpin * open,
            particleTime: (nowMs - gesture.openedAt) / 1000,
            time: nowSeconds,
            config,
        };
    }

    function flashAmountForObjectProgress(objProgress) {
        if (objProgress <= 0.85 || objProgress > 1.15) return 0;
        const flashT = 1 - (Math.abs(objProgress - 1) / 0.15);
        return flashT * flashT;
    }

    function shaderInputForTravel(travel, elapsed, nowSeconds, config) {
        if (!travel) return null;
        const from = projectStagePoint(travel.from);
        const to = projectStagePoint(travel.to);
        if (!from?.valid || !to?.valid) return null;
        const capture = captureForCurrentSegment(travel);
        const mapping = textureMappingForCapture(capture, liveJs.displays, projectStagePoint);
        const radiusUv = wormholeRadiusUv(config);
        const vectors = wormholeVectors(from, to, radiusUv);
        const objectMs = Math.max(1, travel.transitMs || (config.objectTravelMs * 2));
        const closeStartMultiplier = Number.isFinite(Number(travel.closeStartMultiplier))
            ? Number(travel.closeStartMultiplier)
            : 1;
        const closeStartExitMultiplier = Number.isFinite(Number(travel.closeStartExitMultiplier))
            ? Number(travel.closeStartExitMultiplier)
            : Math.max(0, vectors.exitMultiplier);
        let effectMultiplier = closeStartMultiplier;
        let exitMultiplier = closeStartExitMultiplier;
        let objProgress = elapsed / Math.max(1, config.objectTravelMs);
        let flashAmount = flashAmountForObjectProgress(objProgress);

        if (elapsed > objectMs) {
            objProgress = closeStartExitMultiplier > 0 ? 2 : 2.5;
            const closeT = clamp01((elapsed - objectMs) / Math.max(1, travel.exitMs || config.closeMs));
            const easeOut = 1 - easeInOutQuad(closeT);
            effectMultiplier = closeStartMultiplier * easeOut;
            exitMultiplier = closeStartExitMultiplier * easeOut;
            if (closeStartExitMultiplier <= 0) flashAmount = Math.max(0, 1 - clamp01((elapsed - objectMs) / 400));
        }

        const active = Math.max(effectMultiplier, exitMultiplier);
        return {
            capture,
            textureOrigin: mapping.textureOrigin,
            textureScale: mapping.textureScale,
            center: vectors.center,
            exitCenter: vectors.exitCenter,
            curve: vectors.curve,
            curveExit: vectors.curveExit,
            effectMultiplier,
            exitMultiplier,
            radius: Math.max(0.001, radiusUv * (0.01 + (0.99 * active))),
            objProgress,
            flashAmount,
            spinAngle: (elapsed / 1000) * config.objectSpin * Math.max(0.1, active),
            particleTime: elapsed / 1000,
            time: nowSeconds,
            config,
        };
    }

    function draw() {
        const ctx = overlay.context();
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const nowMs = performance.now();
        const now = nowMs / 1000;
        const config = wormholeConfig(rendererState);
        const radius = config.radius;
        const exitThreshold = wormholeExitThreshold(rendererState);
        const drawnDisplays = new Set();

        if (gesture) {
            requestAllDisplayCaptures(gesture);
            if (rendererState.wormholeMirrorCaptureProof) {
                wormholeOverlay.clear();
                if (drawMirroredCaptureProof(ctx, captureForCurrentSegment(gesture))) return;
            }
            const shaderInput = shaderInputForGesture(nowMs, now, config);
            if (wormholeOverlay.draw(shaderInput)) return;
            wormholeOverlay.clear();
            const origin = projectStagePoint(gesture.origin);
            const pointer = projectStagePoint(gesture.pointer);
            if (!origin?.valid) return;
            const dist = pointer ? Math.hypot(pointer.x - origin.x, pointer.y - origin.y) : 0;
            const open = easeInOutQuad((performance.now() - gesture.openedAt) / config.openingMs);
            const entryCapture = captureForPoint(gesture, gesture.origin, 'entry') ?? gesture.captures?.entry;
            const exitCapture = captureForPoint(gesture, gesture.pointer, 'exit') ?? gesture.captures?.exit;
            drawCaptureDisplay(ctx, entryCapture, drawnDisplays);
            if (pointer && dist > exitThreshold) drawCaptureDisplay(ctx, exitCapture, drawnDisplays);
            drawTunnel(ctx, origin, pointer, radius, open, {
                twistDirection: 1,
                particleFlow: 'entry',
                time: now,
                capture: entryCapture,
                sourcePoint: gesture.origin,
                burst: 0.45,
                config,
            });
            if (pointer && dist > exitThreshold) {
                drawTunnel(ctx, pointer, origin, radius * 0.92, open * smoothstep((dist - exitThreshold) / Math.max(1, radius * 0.75)), {
                    twistDirection: -1,
                    particleFlow: 'exit',
                    time: now + 0.31,
                    capture: exitCapture,
                    sourcePoint: gesture.pointer,
                    burst: 0.35,
                    config,
                });
            }
            return;
        }

        const travel = liveJs.travel;
        if (!travel || travel.effect !== 'wormhole') {
            wormholeOverlay.clear();
            return;
        }
        const elapsed = nowMs - travel.startMs;
        requestAllDisplayCaptures(travel);
        if (rendererState.wormholeMirrorCaptureProof) {
            wormholeOverlay.clear();
            if (drawMirroredCaptureProof(ctx, captureForCurrentSegment(travel))) return;
        }
        const shaderInput = shaderInputForTravel(travel, elapsed, now, config);
        if (wormholeOverlay.draw(shaderInput)) return;
        wormholeOverlay.clear();
        const entryOpen = elapsed <= travel.entryMs
            ? smoothstep(elapsed / travel.entryMs)
            : Math.max(0, 1 - smoothstep((elapsed - travel.entryMs) / (travel.transitMs + 80)));
        const exitStart = travel.entryMs * 0.35;
        const exitOpen = elapsed <= exitStart
            ? 0
            : (elapsed < travel.entryMs + travel.transitMs
                ? smoothstep((elapsed - exitStart) / Math.max(1, travel.entryMs + travel.transitMs - exitStart))
                : Math.max(0, 1 - smoothstep((elapsed - travel.entryMs - travel.transitMs) / travel.exitMs)));
        const from = projectStagePoint(travel.from);
        const to = projectStagePoint(travel.to);
        drawCaptureDisplay(ctx, travel.captures.entry, drawnDisplays);
        drawCaptureDisplay(ctx, travel.captures.exit, drawnDisplays);
        if (from?.valid) {
            drawTunnel(ctx, from, to, travel.captureRadius, entryOpen, {
                twistDirection: 1,
                particleFlow: 'entry',
                time: now,
                capture: travel.captures.entry,
                sourcePoint: travel.from,
                burst: travel.phase === 'entry' ? 0.9 : 0.55,
                config,
            });
        }
        if (to?.valid) {
            drawTunnel(ctx, to, from, travel.captureRadius * 0.92, exitOpen, {
                twistDirection: -1,
                particleFlow: 'exit',
                time: now + 0.37,
                capture: travel.captures.exit,
                sourcePoint: travel.to,
                burst: travel.phase === 'exit' ? 1.0 : 0.45,
                config,
            });
        }
        drawTravelFlash(ctx, travel, elapsed, config, projectStagePoint);
    }

    return {
        mount() {
            overlay.mount();
            wormholeOverlay.mount();
        },
        beginGesture,
        updateGesture,
        clearGesture,
        start,
        tick,
        preview,
        draw,
        exportSnapshot,
        applySnapshot,
        destroy() {
            gesture = null;
            overlay.destroy();
            wormholeOverlay.destroy();
        },
        get activeGesture() {
            return gesture;
        },
        get activeEffect() {
            return liveJs.travel?.effect ?? gesture?.effect ?? null;
        },
    };
}
