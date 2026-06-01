import {
    applyContextMenuDescriptorUpdate,
    contextMenuControlDescriptors,
    getContextMenuControlDescriptor,
} from './descriptors.js';

function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function statePathText(value) {
    return (Array.isArray(value) ? value : text(value).split('.'))
        .filter((part) => part !== '')
        .join('.');
}

export function contextMenuDescriptorForVisualObjectDescriptor(descriptor = {}) {
    if (!descriptor) return null;
    return getContextMenuControlDescriptor(descriptor.id)
        || getContextMenuControlDescriptor(descriptor.state_path)
        || getContextMenuControlDescriptor(descriptor.action_id)
        || contextMenuControlDescriptors.find((entry) => (
            statePathText(entry.statePath) === statePathText(descriptor.state_path)
            && (!descriptor.route || entry.route === descriptor.route)
        ))
        || null;
}

export function createVisualObjectBindingAdapter({
    descriptorContext,
    recordTrace,
} = {}) {
    const context = typeof descriptorContext === 'function' ? descriptorContext : () => ({});

    function applyVisualObjectDescriptorUpdate(bindingContext = {}) {
        const { descriptor, mutation } = bindingContext;
        const compatibility = contextMenuDescriptorForVisualObjectDescriptor(descriptor);
        if (!compatibility) return false;

        const updateContext = context();
        const result = applyContextMenuDescriptorUpdate(
            compatibility.id,
            mutation?.value,
            {
                ...updateContext,
                onAppearanceChange(event = {}) {
                    updateContext.onAppearanceChange?.({
                        ...event,
                        descriptor,
                        compatibilityDescriptor: event.descriptor,
                        descriptorContract: 'aos.visual_object.descriptor.v0',
                    });
                },
            }
        );
        if (!result) return false;

        recordTrace?.('visual-object-binding-update', {
            descriptorId: descriptor.id,
            compatibilityId: compatibility.id,
            route: mutation?.route,
            value: result.value,
        });
        return true;
    }

    return {
        routeHandlers: {
            'canvas_object.transform.patch': applyVisualObjectDescriptorUpdate,
            'canvas_object.effects.patch': applyVisualObjectDescriptorUpdate,
        },
        rendererSyncHandlers: {},
    };
}
