import { useState } from 'react'
import {
  IconChevronDownOutline14,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'

export interface HeroineSelectOption {
  value: string
  label: string
}

interface HeroineSelectProps {
  value: string
  options: HeroineSelectOption[]
  disabled?: boolean
  side?: 'top' | 'bottom'
  fullWidth?: boolean
  className?: string
  onChange: (value: string) => void
}

export function HeroineSelect({
  value,
  options,
  disabled = false,
  side = 'bottom',
  fullWidth = false,
  className = '',
  onChange,
}: HeroineSelectProps) {
  const [open, setOpen] = useState(false)
  const activeLabel = options.find((option) => option.value === value)?.label ?? value

  return (
    <Menu
      className={`heroine-menu-root${fullWidth ? ' heroine-menu-root-full' : ''}`}
      open={open}
      onClose={() => setOpen(false)}
      items={options.map((option) => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => {
        onChange(id)
        setOpen(false)
      }}
      side={side}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={`heroine-menu-select heroine_selector${className ? ` ${className}` : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled || options.length === 0}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="heroine-menu-select-label">{activeLabel}</span>
          <IconChevronDownOutline14 className="heroine-menu-select-chevron" />
        </button>
      )}
    />
  )
}
