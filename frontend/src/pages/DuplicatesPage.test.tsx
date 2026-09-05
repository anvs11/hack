import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createTestRouter } from '../app/router'


function renderPage() {
  render(<RouterProvider router={createTestRouter('/duplicates')} />)
}


describe('duplicate review queue', () => {
  it('shows the model score and both comparable publications', async () => {
    renderPage()

    expect(await screen.findByText('91%')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Открыть карточку →' })).toHaveLength(2)
    expect(screen.getByText('Qwen/Qwen3-Embedding-0.6B', { exact: false })).toBeInTheDocument()
  })

  it('saves a human verdict and removes it from the unreviewed queue', async () => {
    renderPage()
    const comment = await screen.findByLabelText('Комментарий · необязательно')
    fireEvent.change(comment, { target: { value: 'Одна тема, но разные события' } })

    fireEvent.click(screen.getByRole('button', { name: 'Связанные темы' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Очередь пуста' })).toBeInTheDocument()
    })
  })
})
