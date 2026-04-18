export function getTurbulence(time, speed, mode, index, count, seed) {
    let t = time * speed;
    let phase = 0;
    if (mode === 'staggered') {
        phase = count > 1 ? index * (Math.PI * 2 / count) : 0;
    } else if (mode === 'random') {
        phase = seed * Math.PI * 2;
    }
    return (Math.sin(t + phase) + Math.sin(1.72 * t + phase * 1.5 + 1.2) + Math.sin(2.31 * t + phase * 0.7 + 2.5)) / 3.0;
}

export function phaseForIndex(index, count) {
    return count > 1 ? index * ((Math.PI * 2) / count) : 0;
}

export function balancedDirectionForIndex(index, count) {
    const phi = Math.PI * (3.0 - Math.sqrt(5.0));
    const y = count > 0 ? 1.0 - (index / count) : 1.0;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * index;
    return new THREE.Vector3(
        radius * Math.cos(theta),
        y,
        radius * Math.sin(theta)
    ).normalize();
}

export function syncInstanceCount(currentCountFn, targetCount, addItemFn, removeItemFn) {
    while (currentCountFn() < targetCount) {
        addItemFn();
    }

    while (currentCountFn() > targetCount) {
        removeItemFn();
    }
}
