import { mountPanel, Single } from '../../panel/index.js'
import { dispatchAosAction } from '../../runtime/action.js'

export const AOS_ACTION_DEMO_URL = 'https://www.example.com/'

export function createAosActionDemoContent({
  url = AOS_ACTION_DEMO_URL,
  dispatch = dispatchAosAction,
} = {}) {
  return {
    manifest: {
      name: 'aos-action-demo',
      title: 'AOS Action Demo',
      emits: ['aos.action'],
    },
    render() {
      const root = document.createElement('section')
      root.className = 'aos-action-demo'

      const link = document.createElement('a')
      link.className = 'aos-action-demo__link'
      link.href = url
      link.textContent = 'Open example.com'
      link.dataset.aosRef = 'aos-action-demo:external-link'
      link.dataset.aosSurface = 'aos-action-demo'

      const status = document.createElement('div')
      status.className = 'aos-action-demo__status'
      status.setAttribute('role', 'status')

      link.addEventListener('click', (event) => {
        event.preventDefault()
        status.textContent = 'Opening link...'
        dispatch('macos.open_url', {
          url,
          event,
          element: link,
          control: {
            id: 'external-link',
            surface: 'aos-action-demo',
            aos_ref: 'aos-action-demo:external-link',
          },
        }).then((result) => {
          status.textContent = result?.status === 'ok' ? 'Opened' : 'Open requested'
        }).catch((error) => {
          status.textContent = error?.message || 'Open failed'
        })
      })

      root.append(link, status)
      return root
    },
  }
}

if (typeof document !== 'undefined' && document.body) {
  mountPanel({
    title: 'Action Demo',
    layout: Single(createAosActionDemoContent()),
    draggable: true,
    close: true,
    minimize: false,
    maximize: false,
  })
}
