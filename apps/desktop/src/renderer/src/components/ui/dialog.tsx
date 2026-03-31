import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

function DialogRoot(props: DialogPrimitive.Root.Props): React.JSX.Element {
  return <DialogPrimitive.Root {...props} />
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props): React.JSX.Element {
  return <DialogPrimitive.Trigger {...props} />
}

function DialogPortal(props: DialogPrimitive.Portal.Props): React.JSX.Element {
  return <DialogPrimitive.Portal {...props} />
}

function DialogBackdrop({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm',
        'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        'transition-opacity duration-200',
        className
      )}
      {...props}
    />
  )
}

function DialogPopup({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Popup
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
        'flex overflow-hidden rounded-xl border border-border dialog-surface shadow-2xl',
        'data-[starting-style]:opacity-0 data-[starting-style]:scale-95',
        'data-[ending-style]:opacity-0 data-[ending-style]:scale-95',
        'transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Popup>
  )
}

function DialogClose({ className, ...props }: DialogPrimitive.Close.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Close
      className={cn(
        'absolute right-3 top-3 z-10 flex size-6 items-center justify-center rounded-md',
        'text-foreground/40 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/70',
        className
      )}
      {...props}
    >
      <IconX style={{ width: 14, height: 14 }} stroke={2} />
    </DialogPrimitive.Close>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogClose,
  DialogTitle,
  DialogDescription
}
